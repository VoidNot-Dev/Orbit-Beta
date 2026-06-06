const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
require('ts-node/register')

const PageController = require('../src/automation/PageController').default

function createController() {
    return new PageController({
        isMobile: true,
        accessToken: '',
        utils: {
            getFormattedDate: () => '06/06/2026'
        },
        logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        }
    })
}

function parseDashboardHtml(html) {
    const controller = createController()
    return controller.parseDashboardHtml(html)
}

test('Next.js dashboard fallback converts Bing search progress into legacy counters', () => {
    const html = `
        <html>
            <head>
                <script>window.telemetryContext = {"country":"us","language":"en"};</script>
            </head>
            <body>
                <p>7,001</p><img alt="Gold Level">
                <script>
                    self.__next_f.push([1,"0:{\\"children\\":\\"Dashboard\\"}\\n1:[\\"$\\",\\"p\\",null,{\\"children\\":\\"Bing\\"}]\\n2:[\\"$\\",\\"$L72\\",null,{\\"value\\":0,\\"maxValue\\":1,\\"aria-label\\":\\"Bing\\"}]\\n3:[\\"$\\",\\"span\\",null,{\\"children\\":\\"Search: 0/1\\"}]"])
                </script>
            </body>
        </html>
    `

    const data = parseDashboardHtml(html)
    const pcSearch = data.userStatus.counters.pcSearch

    assert.equal(data.userStatus.availablePoints, 7001)
    assert.equal(pcSearch.length, 1)
    assert.equal(pcSearch[0].pointProgress, 0)
    assert.equal(pcSearch[0].pointProgressMax, 1)
    assert.equal(data.userStatus.counters.mobileSearch.length, 0)
})

test('provided diagnostics dump exposes nonzero Bing search missing points when present', { skip: !fs.existsSync(path.join(__dirname, '..', 'bot-diagnostics', 'warn-2026-06-06T12-06-18-374Z', 'dump.html')) }, () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'bot-diagnostics', 'warn-2026-06-06T12-06-18-374Z', 'dump.html'),
        'utf8'
    )
    const data = parseDashboardHtml(html)
    const controller = createController()
    const missing = controller.missingSearchPoints(data.userStatus.counters, false)

    assert.equal(data.userStatus.availablePoints, 7001)
    assert.equal(data.userStatus.counters.pcSearch[0].pointProgress, 0)
    assert.equal(data.userStatus.counters.pcSearch[0].pointProgressMax, 1)
    assert.equal(missing.desktopPoints, 1)
    assert.equal(missing.mobilePoints, 0)
})

test('Next.js dashboard fallback keeps real sidebar point offers and ignores zero-point banners', { skip: !fs.existsSync(path.join(__dirname, '..', 'bot-diagnostics', 'warn-2026-06-06T12-59-11-806Z', 'dump.html')) }, () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'bot-diagnostics', 'warn-2026-06-06T12-59-11-806Z', 'dump.html'),
        'utf8'
    )
    const data = parseDashboardHtml(html)
    const quote = data.morePromotions.find(
        promo => promo.offerId === 'ENstar_Rewards_DailyGlobalOffer_Evergreen_Saturday'
    )
    const appInstall = data.morePromotions.find(promo => promo.offerId === 'ENIN_SapphireAppInstall_Announcement_amc')
    const uncompletedPointOffers = data.morePromotions.filter(
        promo => !promo.complete && promo.pointProgressMax > promo.pointProgress
    )

    assert.equal(quote?.title, 'Have you heard this quote?')
    assert.equal(quote?.pointProgress, 0)
    assert.equal(quote?.pointProgressMax, 5)
    assert.match(quote?.destinationUrl ?? '', /Quote%20of%20the%20day/)
    assert.equal(appInstall?.pointProgressMax, 0)
    assert.ok(uncompletedPointOffers.some(promo => promo.offerId === quote?.offerId))
    assert.ok(uncompletedPointOffers.every(promo => promo.pointProgressMax > 0))
})
