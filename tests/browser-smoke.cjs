// Optional UI check: requires Playwright (npm install --no-save playwright).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
        await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '?test=1');
        await page.locator('#modeSelect').selectOption('daily');
        await page.locator('#btnPlay').click();
        const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('bb.game.v1')));
        const initial = await saved();
        assert.equal(initial.m, 'daily');
        assert.match(await page.locator('#modeLabel').innerText(), /^Daily/);
        // Drag the first piece to the empty board through the real pointer handlers.
        const defs = JSON.parse(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
            .match(/const PIECE_DEFS = (\[[\s\S]*?\n\]);/)[1].replace(/\/\/[^\n]*/g, '').replace(/,\s*]/g, ']'));
        const shape = defs[initial.t[0].i];
        const w = Math.max(...shape.map(c => c[1])) + 1;
        const h = Math.max(...shape.map(c => c[0])) + 1;
        const box = await page.locator('#board').boundingBox();
        const slot = await page.locator('.slot').first().boundingBox();
        const cell = Math.floor((box.width - 12) / 8);
        await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 6 + w * cell / 2, box.y + 6 + 80 + h * cell, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(() => Number(document.querySelector('#curScore').textContent) > 0);
        assert.equal(Number(await page.locator('#curScore').innerText()), shape.length);
        // pagehide flushes the debounced save during reload.
        await page.reload();
        await page.locator('#btnContinue').click();
        assert.equal(Number(await page.locator('#curScore').innerText()), shape.length);
        assert.equal((await saved()).m, 'daily');
        await page.locator('#menuBtn').click();
        await page.locator('#btnQuitYes').click();
        await page.locator('#modeSelect').selectOption('hard');
        await page.locator('#btnPlay').click();
        assert.equal(await page.locator('#modeLabel').innerText(), 'Hard');
        await page.locator('#menuBtn').click();
        await page.locator('#modeSelect').selectOption('classic');
        await page.locator('#btnPlay').click();
        assert.equal(await page.locator('#modeLabel').innerText(), 'Classic');
        for (const viewport of [{width:390,height:844},{width:320,height:568},{width:1280,height:800}]) {
            await page.setViewportSize(viewport);
            await page.waitForTimeout(300);
            for (const selector of ['#board','#trayWrap','#comboStatus']) {
                const rect = await page.locator(selector).boundingBox();
                assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x+rect.width <= viewport.width+1 && rect.y+rect.height <= viewport.height+1, selector+' fits '+JSON.stringify(viewport));
            }
        }
        await page.setViewportSize({width:390,height:844});
        await page.waitForTimeout(300);
        if (process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SMOKE_SCREENSHOT_DIR,'test-game.png'),animations:'disabled'});
        await page.locator('#menuBtn').click();
        await page.locator('#btnPlay').waitFor({state:'visible'});
        if (process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SMOKE_SCREENSHOT_DIR,'test-menu.png'),animations:'disabled'});
        assert.deepEqual(errors, []);
        console.log('Browser smoke passed: drag, resume, mode switching, mobile/desktop bounds, no console errors.');
    } finally {
        await browser.close();
    }
})().catch(error => {console.error(error);process.exitCode=1;});
