import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identityIsConfigured,resolveIdentity,setIdentityResolver} from '../identity.js';

test('identity bridge is guest-only until a resolver is deliberately installed',async()=>{
 assert.equal(identityIsConfigured(),false);
 assert.equal(await resolveIdentity({headers:{}}),null);
});

test('identity bridge normalizes a trusted account and rejects unsupported roles',async()=>{
 setIdentityResolver(async()=>({id:12,role:'customer',email:' ADA@EXAMPLE.COM ',firstName:' Ada ',lastName:' Lovelace ',phone:' 123 '}));
 assert.equal(identityIsConfigured(),true);
 assert.deepEqual(await resolveIdentity({}),{id:'12',role:'customer',email:'ada@example.com',firstName:'Ada',lastName:'Lovelace',phone:'123'});
 setIdentityResolver(async()=>({role:'owner',email:'owner@example.com'}));
 assert.equal(await resolveIdentity({}),null);
});

test('trusted worker role is preserved by the identity bridge',async()=>{
 setIdentityResolver(async()=>({id:7,role:'worker',email:'worker@example.com',firstName:'Kitchen',lastName:'Worker',phone:'5551234567'}));
 assert.equal((await resolveIdentity({})).role,'worker');
});
