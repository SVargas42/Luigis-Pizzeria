import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile} from '../accounts.js';

test('optional guest phone does not relax account registration or accept malformed numbers',()=>{
 const objProfile={firstName:'Ada',lastName:'Customer',email:'ada@example.com',phone:''};
 assert.throws(()=>validateProfile(objProfile),objError=>objError.status===400);
 assert.equal(validateProfile(objProfile,{bRequirePhone:false}).phone,'');
 const {phone:strPhone,...objNoPhone}=objProfile;
 assert.equal(validateProfile(objNoPhone,{bRequirePhone:false}).phone,'');
 for(const objPhone of ['bad','-------',1234567890,null]){
  if(objPhone===null)continue;
  assert.throws(()=>validateProfile({...objProfile,phone:objPhone},{bRequirePhone:false}));
 }
 assert.equal(validateProfile({...objProfile,phone:'(555) 123-4567'}).phone,'(555) 123-4567');
});
