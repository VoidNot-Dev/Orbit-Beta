import fs from 'fs'

interface TimingEntry {
    label: string
    durationMs: number
}

class RuntimeMetrics {
    private readonly entries: TimingEntry[] = []

    async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const start = Date.now()
        try {
            return await fn()
        } finally {
            this.record(label, Date.now() - start)
        }
    }

    measureSync<T>(label: string, fn: () => T): T {
        const start = Date.now()
        try {
            return fn()
        } finally {
            this.record(label, Date.now() - start)
        }
    }

    record(label: string, durationMs: number): void {
        this.entries.push({ label, durationMs })
    }

    summaryLines(limit = 20): string[] {
        return this.entries
            .slice()
            .sort((a, b) => b.durationMs - a.durationMs)
            .slice(0, limit)
            .map(entry => `${entry.label}: ${this.format(entry.durationMs)}`)
    }

    summaryText(limit = 20): string {
        const lines = this.summaryLines(limit)
        return lines.length ? lines.join(' | ') : 'No timing data recorded'
    }

    writeGitHubSummary(limit = 20): void {
        const summaryPath = process.env.GITHUB_STEP_SUMMARY
        if (!summaryPath) return

        const lines = ['## Orbit Runtime Timing', '', '| Phase | Duration |', '| --- | --- |']
        for (const entry of this.entries.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, limit)) {
            lines.push(`| ${entry.label.replace(/\|/g, '/')} | ${this.format(entry.durationMs)} |`)
        }

        try {
            fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`)
        } catch {
            // Timing summaries are diagnostic only.
        }
    }

    private format(durationMs: number): string {
        if (durationMs >= 60_000) return `${(durationMs / 60_000).toFixed(1)}min`
        if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`
        return `${durationMs}ms`
    }
}

export const runtimeMetrics = new RuntimeMetrics()
