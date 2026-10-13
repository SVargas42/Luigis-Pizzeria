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
