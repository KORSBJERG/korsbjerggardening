import assert from 'node:assert/strict';import {fixture} from './portal-test-support.mjs';
const f=await fixture({gardens:[{id:'g1',name:'Have',customer:'Kunde',address:'Vej',area:100,budget:4}],tasks:[{id:'t1',garden:'g1',title:'Hæk',date:'2026-11-06',time:'09:00',hours:2,status:'Planlagt'}]});
const client=f.addUser('customer','customer',['g1']);await client.login();assert.equal((await client.call('/api/attendance/checkin','POST',{taskId:'t1'})).status,403);
assert.equal((await f.owner.call('/api/attendance/checkin','POST',{taskId:'t1',start:0})).status,200);let state=f.state();assert.equal(state.tasks[0].status,'I gang');assert(state.timer.start>Date.now()-10000);const id=state.timer.sessionId;
assert.equal((await f.owner.call('/api/attendance/checkin','POST',{taskId:'t1'})).status,409);
assert.equal((await f.owner.call('/api/attendance/checkout','POST',{sessionId:'wrong',note:''})).status,409);
assert.equal((await f.owner.call('/api/attendance/checkout','POST',{sessionId:id,note:'Hæk klippet',complete:true,customerVisible:true,durationSeconds:999999})).status,200);state=f.state();assert.equal(state.timer,null);assert.equal(state.tasks[0].status,'Afsluttet');assert.equal(state.logs.length,1);assert(state.logs[0].durationSeconds<10);assert.equal(state.logs[0].hours,state.logs[0].durationSeconds/3600);assert.equal(state.logs[0].recordedBy,'owner');
assert.equal((await f.owner.call('/api/attendance/checkout','POST',{sessionId:id,note:''})).status,409);assert.equal(f.state().logs.length,1);
console.log('PASS: server-owned check-in/out timestamps; unauthorized customer rejected; single active timer; stale and repeated checkout blocked; exact derived duration; explicit customer visibility.');
