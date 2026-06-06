import chalk from 'chalk'
import cluster from 'cluster'
import crypto from 'crypto'
import { errorDiagnostic } from '../helpers/ErrorDiagnostic'
import type { MicrosoftRewardsBot } from '../index'
import type { DashboardPlatform } from '../types/Dashboard'
import type { LogFilter } from '../types/Config'
import { sendDiscord } from './DiscordWebhook'
import { sendNtfy } from './NtfyWebhook'
import { getPool, isCloudMode } from '../helpers/Database'

export type Platform = boolean | 'main'
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'
export type ColorKey = keyof typeof chalk
export interface IpcLog {
    content: string
    level: LogLevel
}

type ChalkFn = (msg: string) => string
interface DbLogEntry {
    level: LogLevel
    title: string
    platform: string
    username: string
    message: string
    pointsData: Record<string, number> | null
}

// Unique ID for this bot run - used to group logs in the dashboard
const RUN_ID = crypto.randomUUID()
const DB_LOG_BATCH_SIZE = 25
const dbLogQueue: DbLogEntry[] = []
let flushingDbLogs = false

function platformText(platform: Platform): DashboardPlatform {
    return platform === 'main' ? 'MAIN' : platform ? 'MOBILE' : 'DESKTOP'
}

function platformBadge(platform: Platform): string {
    return platform === 'main' ? chalk.bgCyan('MAIN') : platform ? chalk.bgBlue('MOBILE') : chalk.bgMagenta('DESKTOP')
}

function getColorFn(color?: ColorKey): ChalkFn | null {
    return color && typeof chalk[color] === 'function' ? (chalk[color] as ChalkFn) : null
}

function consoleOut(level: LogLevel, msg: string, chalkFn: ChalkFn | null): void {
    const out = chalkFn ? chalkFn(msg) : msg
    switch (level) {
        case 'warn':
            return console.warn(out)
        case 'error':
            return console.error(out)
        default:
            return console.log(out)
    }
}

function formatMessage(message: string | Error): string {
    return message instanceof Error ? `${message.message}\n${message.stack || ''}` : message
}

function extractPointsData(title: string, message: string): Record<string, number> | null {
    if (title !== 'ACCOUNT-END' && title !== 'RUN-END') return null

    const collectedMatch = message.match(/Total:\s*\+(\d+)/)
    const oldMatch = message.match(/Old:\s*(\d+)/)
    const newMatch = message.match(/New:\s*(\d+)/)
    if (!collectedMatch) return null

    return {
        collectedPoints: parseInt(collectedMatch[1]!, 10),
        initialPoints: oldMatch ? parseInt(oldMatch[1]!, 10) : 0,
        finalPoints: newMatch ? parseInt(newMatch[1]!, 10) : 0
    }
}

export async function flushDbLogQueue(): Promise<void> {
    while (flushingDbLogs) {
        await new Promise(resolve => setTimeout(resolve, 25))
    }

    if (dbLogQueue.length === 0) return

    const db = getPool()
    if (!db) {
        dbLogQueue.length = 0
        return
    }

    flushingDbLogs = true
    const batch = dbLogQueue.splice(0, dbLogQueue.length)

    try {
        const values: unknown[] = []
        const placeholders = batch
            .map((entry, index) => {
                const offset = index * 7
                values.push(
                    RUN_ID,
                    entry.level,
                    entry.title,
                    entry.platform,
                    entry.username,
                    entry.message,
                    entry.pointsData ? JSON.stringify(entry.pointsData) : null
                )
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
            })
            .join(',')

        await db.query(
            `INSERT INTO run_logs (run_id, level, title, platform, username, message, points_data)
             VALUES ${placeholders}`,
            values
        )
    } catch {
        // Silently fail - logging should never crash the bot.
    } finally {
        flushingDbLogs = false
        if (dbLogQueue.length >= DB_LOG_BATCH_SIZE) {
            void flushDbLogQueue()
        }
    }
}

export class LogService {
    constructor(private bot: MicrosoftRewardsBot) {}

    info(isMobile: Platform, title: string, message: string, color?: ColorKey) {
        return this.baseLog('info', isMobile, title, message, color)
    }

    warn(isMobile: Platform, title: string, message: string | Error, color?: ColorKey) {
        return this.baseLog('warn', isMobile, title, message, color)
    }

    error(isMobile: Platform, title: string, message: string | Error, color?: ColorKey) {
        return this.baseLog('error', isMobile, title, message, color)
    }

    debug(isMobile: Platform, title: string, message: string | Error, color?: ColorKey) {
        return this.baseLog('debug', isMobile, title, message, color)
    }

    private baseLog(
        level: LogLevel,
        isMobile: Platform,
        title: string,
        message: string | Error,
        color?: ColorKey
    ): void {
        const now = new Date().toLocaleString()
        const formatted = formatMessage(message)

        const userName = this.bot.userData.userName ? this.bot.userData.userName : 'MAIN'

        const levelTag = level.toUpperCase()
        const cleanMsg = `[${now}] [${userName}] [${levelTag}] ${platformText(isMobile)} [${title}] ${formatted}`

        const config = this.bot.config

        if (level === 'debug' && !config.debugLogs && !process.argv.includes('-dev')) {
            return
        }

        this.bot.pushDashboardLog({
            time: new Date().toISOString(),
            userName,
            level,
            platform: platformText(isMobile),
            title,
            message: formatted
        })

        const badge = platformBadge(isMobile)
        const consoleStr = `[${now}] [${userName}] [${levelTag}] ${badge} [${title}] ${formatted}`

        let logColor: ColorKey | undefined = color

        if (!logColor) {
            switch (level) {
                case 'error':
                    logColor = 'red'
                    break
                case 'warn':
                    logColor = 'yellow'
                    break
                case 'debug':
                    logColor = 'magenta'
                    break
                default:
                    break
            }
        }

        if ((level === 'error' || level === 'warn') && config.errorDiagnostics) {
            const page = this.bot.isMobile ? this.bot.mainMobilePage : this.bot.mainDesktopPage
            const error = message instanceof Error ? message : new Error(String(message))
            errorDiagnostic(page, error, level)
        }

        const consoleAllowed = this.shouldPassFilter(config.consoleLogFilter, level, cleanMsg)
        const webhookAllowed = this.shouldPassFilter(config.webhook.webhookLogFilter, level, cleanMsg)

        if (consoleAllowed) {
            consoleOut(level, consoleStr, getColorFn(logColor))
        }

        if (!webhookAllowed) {
            return
        }

        if (cluster.isPrimary) {
            if (config.webhook.discord?.enabled && config.webhook.discord.url) {
                if (level === 'debug') return
                sendDiscord(config.webhook.discord.url, cleanMsg, level)
            }

            if (config.webhook.ntfy?.enabled && config.webhook.ntfy.url) {
                if (level === 'debug') return
                sendNtfy(config.webhook.ntfy, cleanMsg, level)
            }
        } else {
            process.send?.({ __ipcLog: { content: cleanMsg, level } })
        }

        // ── Cloud mode: persist key logs to Neon DB ──
        if (isCloudMode() && level !== 'debug') {
            dbLogQueue.push({
                level,
                title,
                platform: platformText(isMobile),
                username: userName,
                message: formatted,
                pointsData: extractPointsData(title, formatted)
            })

            if (dbLogQueue.length >= DB_LOG_BATCH_SIZE || title === 'ACCOUNT-END' || title === 'RUN-END') {
                void flushDbLogQueue()
            }
        }
    }

    private shouldPassFilter(filter: LogFilter | undefined, level: LogLevel, message: string): boolean {
        // If disabled or not, let all logs pass
        if (!filter || !filter.enabled) {
            return true
        }

        const { mode, levels, keywords, regexPatterns } = filter

        const hasLevelRule = Array.isArray(levels) && levels.length > 0
        const hasKeywordRule = Array.isArray(keywords) && keywords.length > 0
        const hasPatternRule = Array.isArray(regexPatterns) && regexPatterns.length > 0

        if (!hasLevelRule && !hasKeywordRule && !hasPatternRule) {
            return mode === 'blacklist'
        }

        const lowerMessage = message.toLowerCase()
        let isMatch = false

        if (hasLevelRule && levels!.includes(level)) {
            isMatch = true
        }

        if (!isMatch && hasKeywordRule) {
            if (keywords!.some(k => lowerMessage.includes(k.toLowerCase()))) {
                isMatch = true
            }
        }

        // Fancy regex filtering if set!
        if (!isMatch && hasPatternRule) {
            for (const pattern of regexPatterns!) {
                try {
                    const regex = new RegExp(pattern, 'i')
                    if (regex.test(message)) {
                        isMatch = true
                        break
                    }
                } catch {}
            }
        }

        return mode === 'whitelist' ? isMatch : !isMatch
    }
}
