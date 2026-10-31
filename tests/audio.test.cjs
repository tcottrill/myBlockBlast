const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const audio = html.slice(html.indexOf('let audioCtx = null;'), html.indexOf('const curScoreEl ='));

// Model browser lifecycle states unavailable to desktop automation. These
// checks exercise recovery decisions, not whether an iPhone speaker is audible.
function setup() {
    const contexts = [];
    const listeners = {};
    const status = {textContent:''};
    const timers = [];
    class Context {
        constructor() {
            this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000;
            this.destination = {}; this.resumes = 0; this.starts = 0;
            contexts.push(this);
        }
        resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
        close() { this.state='closed'; return Promise.resolve(); }
        createBuffer() { return {}; }
        createBufferSource() {
            return { connect() {}, start: () => { if(this.failStart) throw Error('blocked'); this.starts++; } };
        }
        createOscillator() {
            return { connect: node => node, start() {}, stop() {}, frequency: {setValueAtTime(){},linearRampToValueAtTime(){}} };
        }
        createGain() { return { connect() {}, gain: {setValueAtTime(){},linearRampToValueAtTime(){}} }; }
    }
    const ctx = vm.createContext({window:{AudioContext:Context,addEventListener:(name,fn)=>{listeners[name]=fn;}},
        document:{visibilityState:'visible',addEventListener:(name,fn)=>{listeners[name]=fn;},getElementById:()=>status},
        setTimeout:fn=>timers.push(fn),saveMute(){},updateMuteUI(){},console});
    vm.runInContext('let muted=false;\n'+audio,ctx);
    return {contexts,listeners,status,timers,run:code=>vm.runInContext(code,ctx)};
}

test('a gesture resumes an interrupted Safari context', () => {
    const g=setup(); g.run('primeAudio()');
    const ac=g.contexts[0]; ac.state='interrupted';
    g.run('primeAudio()'); assert.equal(ac.state,'running'); assert.equal(ac.resumes,2);
});
test('returning to a visible tab resumes interrupted audio', () => {
    const g=setup();g.run('primeAudio()');g.contexts[0].state='interrupted';
    g.listeners.visibilitychange();assert.equal(g.contexts[0].state,'running');
});
test('closed contexts are replaced on the next gesture', () => {
    const g=setup();g.run('primeAudio()');g.contexts[0].state='closed';g.run('primeAudio()');
    assert.equal(g.contexts.length,2);assert.equal(g.contexts[1].state,'running');
});
test('failed silent-buffer unlock can retry on a later gesture', () => {
    const g=setup();g.run('ensureAudio()');g.contexts[0].failStart=true;
    g.run('primeAudio()');g.contexts[0].failStart=false;g.run('primeAudio()');
    assert.equal(g.contexts[0].starts,1);
});
test('muted gestures do not initialize audio', () => {
    const g=setup();g.run('muted=true;primeAudio()');assert.equal(g.contexts.length,0);
});
test('touch release can unlock audio when touchstart was insufficient', () => {
    const g=setup();assert.equal(typeof g.listeners.touchend,'function');
    g.listeners.touchend();assert.equal(g.contexts[0].state,'running');
});

test('explicit sound test replaces a stuck context and reports its new state', () => {
    const g=setup();g.run('primeAudio()');g.contexts[0].state='interrupted';
    g.run('muted=true;testSound()');
    assert.equal(g.contexts[0].state,'closed');assert.equal(g.contexts.length,2);
    assert.equal(g.contexts[1].state,'running');assert.equal(g.run('muted'),false);
    g.timers.forEach(fn=>fn());assert.match(g.status.textContent,/reports running/);
});

test('rejected resume is retried on the next gesture', async () => {
    const g=setup();g.run('ensureAudio()');const ac=g.contexts[0];
    const resume=ac.resume;ac.resume=()=>Promise.reject(Error('not allowed'));
    g.run('primeAudio()');await Promise.resolve();
    ac.resume=resume;g.run('primeAudio()');assert.equal(ac.state,'running');
});
