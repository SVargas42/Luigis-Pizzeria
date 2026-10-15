import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSyntheticAnalytics,canTransitionStatus,orderAttention,orderBucket,statusLabel} from '../domain.js';

test('current and past order buckets depend on explicit order status, not age',()=>{
 const objOldPending={status:'received',created_at:'2026-10-14T10:00:00.000Z'};
 assert.equal(orderBucket(objOldPending.status),'current');
 assert.equal(orderAttention(objOldPending,new Date('2026-10-14T11:00:00.000Z')),true);
 assert.equal(orderBucket('completed'),'past');
 assert.equal(orderBucket('cancelled'),'past');
 assert.equal(orderAttention({status:'completed',created_at:'2026-10-14T10:00:00.000Z'},new Date('2026-10-14T11:00:00.000Z')),false);
});

test('staff status changes can only move forward or cancel an active order',()=>{
 assert.equal(canTransitionStatus('received','preparing'),true);
 assert.equal(canTransitionStatus('preparing','ready'),true);
 assert.equal(canTransitionStatus('ready','completed'),true);
 assert.equal(canTransitionStatus('received','cancelled'),true);
 assert.equal(canTransitionStatus('completed','preparing'),false);
 assert.equal(canTransitionStatus('cancelled','received'),false);
 assert.equal(canTransitionStatus('received','completed'),false);
});

test('analytics compares yesterday and today without adding a future day',()=>{
 const objNow=new Date('2026-10-15T18:00:00.000Z');
 const objAnalytics=buildSyntheticAnalytics('comparison',objNow);
 assert.deepEqual(objAnalytics.points.map(objPoint=>objPoint.label),['2026-10-14','2026-10-15']);
 assert.ok(objAnalytics.points.every(objPoint=>Number.isInteger(objPoint.value)&&objPoint.value>0));
 assert.equal(objAnalytics.synthetic,true);
 assert.equal(objAnalytics.asOf,'2026-10-15');
});

test('weekday, daily average, and monthly series have plausible date-aligned periods',()=>{
 const objNow=new Date('2026-03-01T12:00:00.000Z');
 const objWeekdays=buildSyntheticAnalytics('weekdays',objNow);
 const objAverage=buildSyntheticAnalytics('average',objNow);
 const objMonthly=buildSyntheticAnalytics('monthly',objNow);
 assert.equal(objWeekdays.points.length,7);
 assert.equal(objAverage.points.length,30);
 assert.equal(objAverage.points.at(-1).label,'2026-03-01');
 assert.equal(objMonthly.points.length,6);
 assert.equal(objMonthly.points.at(-1).label,'Mar 2026');
 assert.ok(objMonthly.points.at(-1).value<objMonthly.points.at(-2).value*2);
 assert.equal(statusLabel('ready'),'Ready for pickup');
 assert.throws(()=>buildSyntheticAnalytics('actual-sales',objNow),RangeError);
});
