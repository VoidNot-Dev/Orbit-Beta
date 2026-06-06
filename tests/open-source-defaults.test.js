const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const root = path.join(__dirname, '..')

test('public example config starts with Core-only workers disabled', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'src/config.example.json'), 'utf8'))

    assert.equal(config.workers.doAppPromotions, false)
    assert.equal(config.workers.doDailyCheckIn, false)
    assert.equal(config.workers.doReadToEarn, false)
    assert.equal(config.workers.doDailyStreak, false)
    assert.equal(config.workers.doRedeemGoal, false)
    assert.equal(config.workers.doDashboardInfo, false)
    assert.equal(config.workers.doClaimPoints, false)
})

test('public example config documents conservative search performance defaults', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'src/config.example.json'), 'utf8'))

    assert.equal(config.searchSettings.stagnantLoopMax, 10)
    assert.equal(config.searchSettings.extraStagnantLoopMax, 5)
    assert.equal(config.searchSettings.relatedQueryExpansionLimit, 50)
    assert.equal(config.searchSettings.pointRefreshInterval, 1)
})

test('scheduled workflow applies fast CI runtime profile and browser cache', () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/rewards.yml'), 'utf8')

    assert.match(workflow, /actions\/cache@v4/)
    assert.match(workflow, /npm ci --prefer-offline --no-audit --no-fund/)
    assert.match(workflow, /scrollRandomResults: false/)
    assert.match(workflow, /clickRandomResults: false/)
    assert.match(workflow, /stagnantLoopMax: 3/)
    assert.match(workflow, /relatedQueryExpansionLimit: 8/)
    assert.match(workflow, /pointRefreshInterval: 2/)
    assert.match(workflow, /BROWSER_CHANNEL: chromium/)
})

test('cloud config honors configured cluster count', () => {
    const loader = fs.readFileSync(path.join(root, 'src/helpers/ConfigLoader.ts'), 'utf8')

    assert.match(loader, /Force headless mode in cloud\/CI environments, but honor the configured cluster count/)
    assert.match(loader, /configData\.headless = true/)
    assert.doesNotMatch(loader, /configData\.clusters = 1/)
})
