'use strict';
// Only run against a disposable database: immutable evidence intentionally cannot be cleaned in place.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {createPgStore}=require('../store');
const {recommend,normalizeMarketplace,digest}=require('../model');
const f=require('../test/fixtures');
const url=process.env.SKILL_GAP_TEST_DATABASE_URL;
test('PostgreSQL: concurrent deduplication, restart replay, immutable evidence, rollback and owned permissions',
  {skip:url?false:'SKILL_GAP_TEST_DATABASE_URL not set'},async t=>{
    const admin=new Pool({connectionString:url});t.after(()=>admin.end());
    const role=`skill_gap_test_${randomUUID().replaceAll('-','')}`;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'disposable-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE SCHEMA IF NOT EXISTS skill_gap_service AUTHORIZATION ${role}`);
    await admin.query(`ALTER SCHEMA skill_gap_service OWNER TO ${role}`);
    await admin.query('REVOKE ALL ON SCHEMA skill_gap_service FROM PUBLIC');
    const config=new URL(url);config.username=role;config.password='disposable-test-only';
    const pool=new Pool({connectionString:config.href});t.after(()=>pool.end());
    await pool.query(fs.readFileSync(path.resolve(__dirname,'../schema.sql'),'utf8'));
    const store=createPgStore(pool), input=f.input('marketplace');input.source.id=randomUUID();
    const raw=f.match();raw.resultId=input.source.id;
    const r=recommend(input,normalizeMarketplace(raw,input),f.pkg(),f.NOW), fingerprint=digest(input);
    const results=await Promise.all(Array.from({length:8},()=>store.create(r,'admin','same-command',fingerprint)));
    assert.equal(results.filter(x=>!x.replay).length,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM skill_gap_service.recommendations WHERE id=$1',[r.recommendationId])).rows[0].n,1);
    const restarted=createPgStore(pool);
    assert.deepEqual((await restarted.byCommand('admin','same-command')).document,r);
    await assert.rejects(restarted.create(r,'admin','same-command','conflict'),{code:'idempotency_conflict'});
    await assert.rejects(store.handoff(r.recommendationId,async()=>{throw new Error('interrupted');}));
    assert.equal(await store.delivery(r.recommendationId),null);
    await store.handoff(r.recommendationId,async()=>({outcome:'pending',reason:'timeout'}));
    assert.equal((await restarted.delivery(r.recommendationId)).outcome,'pending');
    let calls=0;
    const deliveries=await Promise.all(Array.from({length:5},()=>store.handoff(r.recommendationId,async()=>{calls++;return {outcome:'delivered',trainingSessionId:'one-session'};})));
    assert.equal(calls,1);assert.ok(deliveries.every(x=>x.trainingSessionId==='one-session'));
    for(const table of ['recommendations','commands','deliveries','handoff_attempts']) {
      const column=table==='commands'?'actor':'document';
      await assert.rejects(pool.query(`UPDATE skill_gap_service.${table} SET ${column}=${column}`),/immutable skill gap evidence/);
      await assert.rejects(pool.query(`DELETE FROM skill_gap_service.${table}`));
    }
    await admin.query('CREATE SCHEMA IF NOT EXISTS protected_domain');
    await admin.query('CREATE TABLE IF NOT EXISTS protected_domain.decisions (id int)');
    await assert.rejects(pool.query('SELECT * FROM protected_domain.decisions'),{code:'42501'});
    assert.equal((await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);
  });
