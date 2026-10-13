import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateOrder} from '../validation.js';
const menu=new Map([['pizza:Small',1000],['pizza:Large',1600],['topping:Cheese',150],['side:Breadsticks',500],['drink:Medium',275]]);
const order=()=>({requestKey:'12345678-1234-4123-8123-123456789abc',customer:{firstName:' Ada ',lastName:'Lovelace',email:'ADA@example.com',phone:''},pizzas:[{size:'Large',toppings:['Cheese']}],sides:[{name:'Breadsticks',quantity:2}],drinks:[{name:'Coke',size:'Medium',quantity:3}],total:1});
test('server prices override client total and use integer cents',()=>{const result=validateOrder(order(),menu);assert.equal(result.total,3575);assert.equal(result.customer.email,'ada@example.com');assert.equal(result.customer.firstName,'Ada');});
test('rejects invalid and manipulated selections',()=>{for(const change of [o=>o.pizzas[0].size='Free',o=>o.pizzas[0].toppings=['Cheese','Cheese'],o=>o.drinks[0].quantity=-1,o=>o.drinks[0].quantity=1.5,o=>o.customer.email='invalid',o=>o.pizzas=[],o=>o.requestKey='bad',o=>o.sides[0]=null,o=>o.customer.phone='<script>']){const o=order();change(o);assert.throws(()=>validateOrder(o,menu));}});
test('preserves customer text as data for parameterized storage',()=>{const o=order();o.customer.lastName="O'Connor";assert.equal(validateOrder(o,menu).customer.lastName,"O'Connor");});
