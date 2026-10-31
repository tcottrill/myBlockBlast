const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function game() {
    const storage = new Map();
    const noop = () => {};
    const el = () => ({ value: 'classic', style: {}, classList: { add: noop, remove: noop }, getBoundingClientRect: () => ({}) });
    const sandbox = { assert, console, setTimeout: noop, clearTimeout: noop,
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
        window: { setTimeout: noop },
    };
    for (const name of ['playSfx','spawnClearParticles','flashCombo','spawnScorePop','updateScoreUI','layoutTray','ensureAnimLoop','draw','showGameOver','updateModeMenu']) sandbox[name] = noop;
    for (const name of ['boardWrap','dlgMenu','dlgGameOver','dlgConfirm','menuBestEl','btnContinue','modeSelect','modeLabel','comboStatus']) sandbox[name] = el();
    const ctx = vm.createContext(sandbox);
    const sections = [
        script.slice(script.indexOf('const GRID'), script.indexOf('const canvas =')),
        script.slice(script.indexOf('function commitPlacement('), script.indexOf('function spawnScorePop(')),
        script.slice(script.indexOf('function goToMenu('), script.indexOf('function showGameOver(')),
    ];
    const run = code => vm.runInContext(code, ctx);
    run(sections.join('\n'));
    run(`function drop(clear = false) {
        resetBoard(); boardSet(7,7,1);
        if (clear) for (let c=0;c<7;c++) boardSet(0,c,1);
        tray = [{piece:PIECES[0],colorIdx:1},{piece:PIECES[0],colorIdx:1},null];
        commitPlacement(PIECES[0],1,0,0,clear?7:0);
    }`);
    return { run, storage };
}

test('combo survives two setup moves and resets after three', () => {
    game().run(`
        drop(true); assert.equal(score,11);
        drop(); drop(); drop(true); assert.equal(score,34);
        drop(); drop(); drop(); drop(true); assert.equal(score,48);
    `);
});

test('multi-line clear multiplies line points and an empty board awards 300', () => {
    game().run(`
        streak=2; resetBoard(); boardSet(7,7,1);
        for(let i=1;i<8;i++){boardSet(0,i,1);boardSet(i,0,1);}
        tray=[{piece:PIECES[0],colorIdx:1}, {piece:PIECES[0],colorIdx:1}, null];
        commitPlacement(PIECES[0],1,0,0,0); assert.equal(score,121);
        resetBoard(); streak=0; score=0;
        for(let i=0;i<7;i++) boardSet(0,i,1);
        commitPlacement(PIECES[0],1,1,0,7); assert.equal(score,311);
    `);
});

test('line multiplier caps at eight while combo count continues', () => {
    game().run(`streak=8; drop(true); assert.equal(score,81); assert.equal(streak,9);`);
});

// Independent exhaustive solver: tests the dealt tray, not the generator's witness.
const solver = `
function solvable(cells, pieces) {
    if (!pieces.length) return true;
    for(let p=0;p<pieces.length;p++) {
        const shape=pieces[p];
        for(let r=0;r+shape.h<=8;r++) for(let c=0;c+shape.w<=8;c++) {
            if(shape.cells.some(([y,x])=>cells[(r+y)*8+c+x])) continue;
            const next=cells.slice();
            for(const [y,x] of shape.cells) next[(r+y)*8+c+x]=1;
            const full=[];
            for(let i=0;i<8;i++) {
                if(Array.from({length:8},(_,j)=>next[i*8+j]).every(Boolean)) for(let j=0;j<8;j++) full.push(i*8+j);
                if(Array.from({length:8},(_,j)=>next[j*8+i]).every(Boolean)) for(let j=0;j<8;j++) full.push(j*8+i);
            }
            for(const k of full) next[k]=0;
            if(solvable(next,pieces.filter((_,i)=>i!==p))) return true;
        }
    }
    return false;
}`;

test('Classic deals a playable whole tray without altering the real board', () => {
    game().run(solver + `
        let seed=12345; Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        for(let trial=0;trial<40;trial++) {
            board=Uint8Array.from({length:64},(_,i)=> (i%8 === (i/8|0)) ? 0 : (Math.random()<0.8 ? 1 : 0));
            const before=Array.from(board); refillTray();
            assert.deepEqual(Array.from(board),before);
            assert.equal(tray.length,3);
            assert.ok(solvable(before,tray.map(s=>s.piece)), 'unsolvable tray '+trial);
        }
    `);
});

test('Hard keeps unrestricted random dealing', () => {
    game().run(`modeSelect.value='hard'; startNewGame();
        board.fill(1); for(let i=0;i<8;i++)boardSet(i,i,0);
        Math.random=()=>0.3; refillTray();
        assert.equal(anyPieceFits(tray),false);
    `);
});

test('Daily replay and save/restore preserve the piece sequence', () => {
    game().run(`modeSelect.value='daily'; startNewGame();
        const opening=JSON.stringify(tray); refillTray();
        const second=JSON.stringify(tray);
        startNewGame(); assert.equal(JSON.stringify(tray),opening);
        refillTray(); assert.equal(JSON.stringify(tray),second);
        streak=3; movesWithoutClear=2; doSaveGame(); const saved=loadSavedGame();
        refillTray(); const next=JSON.stringify(tray);
        restoreFromSave(saved); refillTray(); assert.equal(JSON.stringify(tray),next);
        drop(true); assert.equal(score,41);
    `);
});

test('best scores are separate and legacy saves still resume', () => {
    game().run(`bestScore=123;saveBest(); modeSelect.value='hard';startNewGame();
        assert.equal(bestScore,0); bestScore=456;saveBest();
        modeSelect.value='classic';startNewGame();assert.equal(bestScore,123);
        restoreFromSave({v:1,b:Array(64).fill(0),t:[{i:0,c:1},null,null],s:22,st:2});
        assert.equal(score,22);assert.equal(streak,2);assert.equal(mode,'classic');
    `);
});

test('Daily dates have distinct sequences and best scores; effects do not consume the sequence', () => {
    game().run(`mode='daily';dailyDate='2026-10-30';randomState=seedForDate(dailyDate);
        refillTray();const first=JSON.stringify(tray);bestScore=99;saveBest();
        dailyDate='2026-10-31';randomState=seedForDate(dailyDate);refillTray();
        assert.notEqual(JSON.stringify(tray),first);loadBest();assert.equal(bestScore,0);
        dailyDate='2026-10-30';randomState=seedForDate(dailyDate);
        for(let i=0;i<100;i++)Math.random();refillTray();
        assert.equal(JSON.stringify(tray),first);loadBest();assert.equal(bestScore,99);
    `);
});

test('existing board sanity checks', () => {
    const g=game();
    const start=script.indexOf('function runTests(');
    const end=script.indexOf('function boot(');
    g.run(script.slice(start,end).replace('const assert = (name, cond) => { results.push({ name, ok: !!cond }); };',
        'const assert = (name, cond) => { if (!cond) throw new Error(name); results.push({name,ok:true}); };'));
    g.run('runTests()');
});
