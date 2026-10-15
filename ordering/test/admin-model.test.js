import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEditedItems} from '../admin-model.js';

test('admin order editor parses item rows without accepting client prices',()=>{
 assert.deepEqual(parseEditedItems('pizza | Large pizza with Cheese, Pepperoni | 1\nside | Breadsticks | 2\ndrink | Dr Pepper (Large) | 1'),[
  {kind:'pizza',description:'Large pizza with Cheese, Pepperoni',quantity:1},
  {kind:'side',description:'Breadsticks',quantity:2},
  {kind:'drink',description:'Dr Pepper (Large)',quantity:1}
 ]);
});

test('admin order editor rejects ambiguous rows and fractional quantities',()=>{
 assert.throws(()=>parseEditedItems('pizza|Large pizza'));
 assert.throws(()=>parseEditedItems('side | Breadsticks | 1.5'));
});
