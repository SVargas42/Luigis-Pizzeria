export function validateOrder(objBody, mapMenu) {
 const failValidation = () => {throw new Error('Please check your customer details and order selections.');};
 const hasText = (strValue,nMaximum) => typeof strValue==='string' && strValue.trim().length>0 && strValue.trim().length<=nMaximum;
 const objCustomer=objBody?.customer;
 if(!objCustomer || !hasText(objCustomer.firstName,80) || !hasText(objCustomer.lastName,80) || !hasText(objCustomer.email,254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(objCustomer.email.trim()) || typeof objCustomer.phone!=='string' || objCustomer.phone.length>30 || !/^[0-9+() .-]*$/.test(objCustomer.phone)) failValidation();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objBody.requestKey || '')) failValidation();
 if(!Array.isArray(objBody.pizzas) || !objBody.pizzas.length || objBody.pizzas.length>20 || !Array.isArray(objBody.sides) || objBody.sides.length>2 || !Array.isArray(objBody.drinks) || objBody.drinks.length>20) failValidation();
 const getPrice = (strKind,strName) => {
  if(typeof strName!=='string') failValidation();
  const nPrice=mapMenu.get(`${strKind}:${strName}`);
  if(!Number.isSafeInteger(nPrice) || nPrice<0 || nPrice>1000000) failValidation();
  return nPrice;
 };
 const getQuantity = nQuantity => {
  if(!Number.isInteger(nQuantity) || nQuantity<1 || nQuantity>10) failValidation();
  return nQuantity;
 };
 const arrItems=objBody.pizzas.map(objPizza=>{
  if(!objPizza || !Array.isArray(objPizza.toppings) || objPizza.toppings.length>6 || new Set(objPizza.toppings).size!==objPizza.toppings.length) failValidation();
  const nUnit=getPrice('pizza',objPizza.size)+objPizza.toppings.reduce((nSum,strName)=>nSum+getPrice('topping',strName),0);
  return {kind:'pizza',description:`${objPizza.size} pizza${objPizza.toppings.length?' with '+objPizza.toppings.join(', '):''}`,quantity:1,unit:nUnit};
 });
 for(const objSide of objBody.sides){
  if(!objSide) failValidation();
  arrItems.push({kind:'side',description:objSide.name,quantity:getQuantity(objSide.quantity),unit:getPrice('side',objSide.name)});
 }
 for(const objDrink of objBody.drinks){
  if(!objDrink || !['Coke','Pepsi','Dr Pepper','Water'].includes(objDrink.name)) failValidation();
  arrItems.push({kind:'drink',description:`${objDrink.name} (${objDrink.size})`,quantity:getQuantity(objDrink.quantity),unit:getPrice('drink',objDrink.size)});
 }
 const nTotal=arrItems.reduce((nSum,objItem)=>nSum+objItem.quantity*objItem.unit,0);
 if(!Number.isSafeInteger(nTotal) || nTotal>4294967295) failValidation();
 return {customer:{firstName:objCustomer.firstName.trim(),lastName:objCustomer.lastName.trim(),email:objCustomer.email.trim().toLowerCase(),phone:objCustomer.phone.trim()},items:arrItems,total:nTotal};
}

export function normalizeEditableItems(arrItems, mapMenu) {
 if(!Array.isArray(arrItems)) throw new Error('Choose valid order items.');
 const getPrice=(strKind,strName)=>{
  const nPrice=mapMenu.get(`${strKind}:${strName}`);
  if(!Number.isSafeInteger(nPrice)||nPrice<0) throw new Error('One or more items are not on the current menu.');
  return nPrice;
 };
 const getQuantity=nQuantity=>{
  if(!Number.isInteger(nQuantity)||nQuantity<1||nQuantity>10) throw new Error('Item quantity must be between 1 and 10.');
  return nQuantity;
 };
 return arrItems.map(objItem=>{
  if(!objItem||typeof objItem.description!=='string'||objItem.description.length>200) throw new Error('Enter a valid item description.');
  const strDescription=objItem.description.trim();
  const nQuantity=getQuantity(objItem.quantity);
  if(objItem.kind==='pizza'){
   const objMatch=strDescription.match(/^(Small|Medium|Large) pizza(?: with ([A-Za-z ,]+))?$/i);
   if(!objMatch) throw new Error('Pizza format: Medium pizza with Cheese, Pepperoni.');
   const strSize=objMatch[1][0].toUpperCase()+objMatch[1].slice(1).toLowerCase();
   const arrToppings=objMatch[2]?objMatch[2].split(',').map(strName=>strName.trim()):[];
   if(arrToppings.length>6||new Set(arrToppings.map(strName=>strName.toLowerCase())).size!==arrToppings.length) throw new Error('Each pizza can have up to six unique toppings.');
   const arrNormalized=arrToppings.map(strName=>{
    const strNameOnMenu=['Cheese','Pepperoni','Sausage','Pineapple','Olives','Barbeque Chicken'].find(strMenuName=>strMenuName.toLowerCase()===strName.toLowerCase());
    if(!strNameOnMenu) throw new Error('One or more toppings are not on the menu.');
    getPrice('topping',strNameOnMenu);
    return strNameOnMenu;
   });
   const strFinal=`${strSize} pizza${arrNormalized.length?' with '+arrNormalized.join(', '):''}`;
   return {kind:'pizza',description:strFinal,quantity:nQuantity,unit:getPrice('pizza',strSize)+arrNormalized.reduce((nSum,strName)=>nSum+getPrice('topping',strName),0)};
  }
  if(objItem.kind==='side'){
   if(!['Breadsticks','Pizza Bites'].includes(strDescription)) throw new Error('Choose Breadsticks or Pizza Bites for a side.');
   return {kind:'side',description:strDescription,quantity:nQuantity,unit:getPrice('side',strDescription)};
  }
  if(objItem.kind==='drink'){
   const objMatch=strDescription.match(/^(Coke|Pepsi|Dr Pepper|Water) \((Small|Medium|Large)\)$/i);
   if(!objMatch) throw new Error('Drink format: Dr Pepper (Large).');
   const strDrink=['Coke','Pepsi','Dr Pepper','Water'].find(strName=>strName.toLowerCase()===objMatch[1].toLowerCase());
   const strSize=['Small','Medium','Large'].find(strName=>strName.toLowerCase()===objMatch[2].toLowerCase());
   return {kind:'drink',description:`${strDrink} (${strSize})`,quantity:nQuantity,unit:getPrice('drink',strSize)};
  }
  throw new Error('Choose pizza, side, or drink for every order item.');
 });
}
