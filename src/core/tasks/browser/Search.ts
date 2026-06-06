import { randomBytes } from 'crypto'
import type { Page } from 'patchright'
import type { Counters, DashboardData } from '../../../types/DashboardData'

import { BING_SEARCH } from '../../../automation/DashboardSelectors'
import { runtimeMetrics } from '../../../helpers/RuntimeMetrics'
import { QueryProvider } from '../../QueryProvider'
import { TaskBase } from '../../TaskBase'

export class Search extends TaskBase {
    private bingHome = 'https://bing.com'
    private searchPageURL = ''
    private searchCount = 0

    public async doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number> {
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(isMobile, 'SEARCH-BING', `Starting Bing searches | currentPoints=${startBalance}`)

        let totalGainedPoints = 0

        try {
            let searchCounters: Counters = await this.bot.browser.func.getSearchPoints()
            const missingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
            let missingPointsTotal = missingPoints.totalPoints

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `Initial search counters | mobile=${missingPoints.mobilePoints} | desktop=${missingPoints.desktopPoints} | edge=${missingPoints.edgePoints}`
            )

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Search points remaining | Edge=${missingPoints.edgePoints} | Desktop=${missingPoints.desktopPoints} | Mobile=${missingPoints.mobilePoints}`
            )

            const queryCore = new QueryProvider(this.bot)
            const locale = (this.bot.userData.geoLocale ?? 'in').toUpperCase()
            const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `Resolving search queries via QueryCore | locale=${locale} | lang=${langCode} | related=true`
            )

            let queries = await runtimeMetrics.measure(`query generation ${isMobile ? 'mobile' : 'desktop'}`, () =>
                queryCore.queryManager({
                    shuffle: true,
                    related: true,
                    langCode,
                    geoLocale: locale,
                    sourceOrder: ['google', 'wikipedia', 'reddit', 'local'],
                    relatedExpansionLimit: this.bot.config.searchSettings.relatedQueryExpansionLimit
                })
            )

            queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]

            this.bot.logger.info(isMobile, 'SEARCH-BING', `Search query pool ready | count=${queries.length}`)

            // Go to bing
            const targetUrl = this.searchPageURL ? this.searchPageURL : this.bingHome
            this.bot.logger.debug(isMobile, 'SEARCH-BING', `Navigating to search page | url=${targetUrl}`)

            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
            await this.bot.browser.utils.tryDismissAllMessages(page)

            let stagnantLoop = 0
            const stagnantLoopMax = this.bot.config.searchSettings.stagnantLoopMax ?? 10

            for (let i = 0; i < queries.length; i++) {
                const query = queries[i] as string

                const refreshedCounters = await this.bingSearch(page, query, isMobile)
                if (!refreshedCounters) {
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `Point refresh skipped | query="${query}" | remaining=${missingPointsTotal}`
                    )
                    continue
                }

                searchCounters = refreshedCounters
                const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                const newMissingPointsTotal = newMissingPoints.totalPoints

                const rawGained = missingPointsTotal - newMissingPointsTotal
                const gainedPoints = Math.max(0, rawGained)

                if (gainedPoints === 0) {
                    stagnantLoop++
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `No points gained ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${newMissingPointsTotal}`
                    )
                } else {
                    stagnantLoop = 0

                    const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                    this.bot.userData.currentPoints = newBalance
                    this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                    totalGainedPoints += gainedPoints

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `gainedPoints=${gainedPoints} points | query="${query}" | remaining=${newMissingPointsTotal}`,
                        'green'
                    )
                }

                missingPointsTotal = newMissingPointsTotal

                if (missingPointsTotal === 0) {
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        'All required search points earned, stopping main search loop'
                    )
                    break
                }

                if (stagnantLoop >= stagnantLoopMax) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `Search did not gain points for ${stagnantLoopMax} iterations, aborting main search loop`
                    )
                    stagnantLoop = 0
                    break
                }

                const remainingQueries = queries.length - (i + 1)
                const minBuffer = 20
                if (missingPointsTotal > 0 && remainingQueries < minBuffer) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `Low query buffer while still missing points, regenerating | remainingQueries=${remainingQueries} | missing=${missingPointsTotal}`
                    )

                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines,
                        relatedExpansionLimit: this.bot.config.searchSettings.relatedQueryExpansionLimit
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    queries = [...new Set(merged)]
                    queries = this.bot.utils.shuffleArray(queries)

                    this.bot.logger.debug(isMobile, 'SEARCH-BING', `Query pool regenerated | count=${queries.length}`)
                }
            }

            if (missingPointsTotal > 0) {
                this.bot.logger.info(
                    isMobile,
                    'SEARCH-BING',
                    `Search completed but still missing points, continuing with regenerated queries | remaining=${missingPointsTotal}`
                )

                let stagnantLoop = 0
                const stagnantLoopMax = this.bot.config.searchSettings.extraStagnantLoopMax ?? 5
                const extra = await queryCore.queryManager({
                    shuffle: true,
                    related: true,
                    langCode,
                    geoLocale: locale,
                    sourceOrder: this.bot.config.searchSettings.queryEngines,
                    relatedExpansionLimit: this.bot.config.searchSettings.relatedQueryExpansionLimit
                })

                while (missingPointsTotal > 0) {
                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    const newPool = [...new Set(merged)]
                    queries = this.bot.utils.shuffleArray(newPool)

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING-EXTRA',
                        `New search query pool generated | count=${queries.length}`
                    )

                    for (const query of queries) {
                        this.bot.logger.info(
                            isMobile,
                            'SEARCH-BING-EXTRA',
                            `Extra search | remaining=${missingPointsTotal} | query="${query}"`
                        )

                        const refreshedCounters = await this.bingSearch(page, query, isMobile)
                        if (!refreshedCounters) {
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `Point refresh skipped | query="${query}" | remaining=${missingPointsTotal}`
                            )
                            continue
                        }

                        searchCounters = refreshedCounters
                        const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                        const newMissingPointsTotal = newMissingPoints.totalPoints

                        const rawGained = missingPointsTotal - newMissingPointsTotal
                        const gainedPoints = Math.max(0, rawGained)

                        if (gainedPoints === 0) {
                            stagnantLoop++
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `No points gained ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${newMissingPointsTotal}`
                            )
                        } else {
                            stagnantLoop = 0

                            const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                            this.bot.userData.currentPoints = newBalance
                            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                            totalGainedPoints += gainedPoints

                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `gainedPoints=${gainedPoints} points | query="${query}" | remaining=${newMissingPointsTotal}`,
                                'green'
                            )
                        }

                        missingPointsTotal = newMissingPointsTotal

                        if (missingPointsTotal === 0) {
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                'All required search points earned during extra searches'
                            )
                            break
                        }

                        if (stagnantLoop >= stagnantLoopMax) {
                            this.bot.logger.warn(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `Search did not gain points for ${stagnantLoopMax} iterations, aborting extra searches`
                            )
                            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING',
                                `Aborted extra searches | startBalance=${startBalance} | finalBalance=${finalBalance}`
                            )
                            return totalGainedPoints
                        }
                    }
                }
            }

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Completed Bing searches | startBalance=${startBalance} | newBalance=${finalBalance}`
            )

            return totalGainedPoints
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-BING',
                `Error in doSearch | message=${error instanceof Error ? error.message : String(error)}`
            )
            return totalGainedPoints
        }
    }

    private async bingSearch(searchPage: Page, query: string, isMobile: boolean): Promise<Counters | null> {
        const maxAttempts = 5
        const refreshThreshold = 10 // Page gets sluggish after x searches?
        const pointRefreshInterval = this.bot.config.searchSettings.pointRefreshInterval ?? 1

        this.searchCount++

        if (this.searchCount % refreshThreshold === 0) {
            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Returning to home page to clear accumulated page context | count=${this.searchCount} | threshold=${refreshThreshold}`
            )

            this.bot.logger.debug(isMobile, 'SEARCH-BING', `Returning home to refresh state | url=${this.bingHome}`)

            await this.navigateToSearchUrl(searchPage, query, isMobile)
            await this.bot.browser.utils.tryDismissAllMessages(searchPage)
        }

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `Starting bingSearch | query="${query}" | maxAttempts=${maxAttempts} | searchCount=${this.searchCount} | refreshEvery=${refreshThreshold} | scrollRandomResults=${this.bot.config.searchSettings.scrollRandomResults} | clickRandomResults=${this.bot.config.searchSettings.clickRandomResults}`
        )

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const searchBar = BING_SEARCH.searchBar
                const searchBox = searchPage.locator(searchBar)
                await this.submitSearchQuery(searchPage, query, isMobile)

                // Use string form so the obfuscator cannot inject outer-scope
                // string-array references inside the evaluate callback body.
                await searchPage.evaluate('window.scrollTo(0, 0)')

                await searchPage.keyboard.press('Home')
                await searchBox.waitFor({ state: 'visible', timeout: 8000 })

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `Submitted query via direct Bing URL | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(1000)

                if (this.bot.config.searchSettings.scrollRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.randomScroll(searchPage, isMobile)
                }

                if (this.bot.config.searchSettings.clickRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.clickRandomLink(searchPage, isMobile)
                }

                await this.bot.utils.wait(
                    this.bot.utils.randomDelay(
                        this.bot.config.searchSettings.searchDelay.min,
                        this.bot.config.searchSettings.searchDelay.max
                    )
                )

                if (pointRefreshInterval > 1 && this.searchCount % pointRefreshInterval !== 0) {
                    this.bot.logger.debug(
                        isMobile,
                        'SEARCH-BING',
                        `Skipping point refresh | interval=${pointRefreshInterval} | count=${this.searchCount} | query="${query}"`
                    )
                    return null
                }

                const counters = await this.bot.browser.func.getSearchPoints()

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `Search counters after query | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                return counters
            } catch (error) {
                const attempt = i + 1
                const message = error instanceof Error ? error.message : String(error)

                if (attempt >= maxAttempts) {
                    this.bot.logger.error(
                        isMobile,
                        'SEARCH-BING',
                        `Failed after ${maxAttempts} attempts | query="${query}" | message=${message}`
                    )
                    break
                }

                this.bot.logger.error(
                    isMobile,
                    'SEARCH-BING',
                    `Search attempt failed | attempt=${attempt}/${maxAttempts} | query="${query}" | message=${message}`
                )

                this.bot.logger.warn(
                    isMobile,
                    'SEARCH-BING',
                    `Retrying search | nextAttempt=${attempt + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(2000)
            }
        }

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `Returning current search counters after failed retries | query="${query}"`
        )

        return await this.bot.browser.func.getSearchPoints()
    }

    private async submitSearchQuery(searchPage: Page, query: string, isMobile: boolean): Promise<void> {
        const currentUrl = searchPage.url()
        if (!this.isBingPage(currentUrl)) {
            this.bot.logger.warn(
                isMobile,
                'SEARCH-BING',
                `Active page is not Bing, submitting query with direct search URL | url=${currentUrl}`
            )
        } else if (!(await searchPage.locator(BING_SEARCH.searchBar).isVisible().catch(() => false))) {
            this.bot.logger.warn(
                isMobile,
                'SEARCH-BING',
                `Bing search box not visible, submitting query with direct search URL | url=${currentUrl}`
            )
        } else {
            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `Submitting query with direct search URL for daily search attribution | url=${currentUrl}`
            )
        }

        await this.navigateToSearchUrl(searchPage, query, isMobile)
    }

    private async navigateToSearchUrl(searchPage: Page, query: string, isMobile: boolean): Promise<void> {
        const url = this.buildSearchUrl(query)
        this.bot.logger.debug(isMobile, 'SEARCH-BING', `Navigating directly to Bing search | url=${url}`)

        await searchPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await this.bot.browser.utils.tryDismissAllMessages(searchPage)
    }

    private buildSearchUrl(query: string): string {
        const cvid = randomBytes(16).toString('hex')
        return `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`
    }

    private isBingPage(url: string): boolean {
        try {
            const hostname = new URL(url).hostname.toLowerCase()
            return hostname === 'bing.com' || hostname.endsWith('.bing.com')
        } catch {
            return false
        }
    }

    private async randomScroll(page: Page, isMobile: boolean) {
        try {
            // String form is immune to obfuscator string-array injection.
            const viewportHeight = await page.evaluate<number>('window.innerHeight')
            const totalHeight = await page.evaluate<number>('document.body.scrollHeight')
            const randomScrollPosition = Math.floor(Math.random() * (totalHeight - viewportHeight))

            this.bot.logger.debug(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `Random scroll | viewportHeight=${viewportHeight} | totalHeight=${totalHeight} | scrollPos=${randomScrollPosition}`
            )

            // Avoid object literal {behavior:'auto'} inside the callback:
            // the string 'auto' would be replaced by a string-array call and
            // become an unresolvable outer-scope reference in the browser.
            await page.evaluate((pos: number) => window.scrollTo(0, pos), randomScrollPosition)
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `An error occurred during random scroll | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async clickRandomLink(page: Page, isMobile: boolean) {
        try {
            this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', 'Attempting to click a random search result link')

            const searchPageUrl = page.url()

            await this.bot.browser.utils.ghostClick(page, BING_SEARCH.resultLinks)
            await this.bot.utils.wait(this.bot.config.searchSettings.searchResultVisitTime)

            if (isMobile) {
                await page.goto(searchPageUrl)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', 'Navigated back to search page')
            } else {
                const newTab = await this.bot.browser.utils.getLatestTab(page)
                const newTabUrl = newTab.url()

                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', `Visited result tab | url=${newTabUrl}`)

                await this.bot.browser.utils.closeTabs(newTab)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', 'Closed result tab')
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-CLICK',
                `An error occurred during random click | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
