export function validateOrder(objBody, mapMenu, arrSideVariations=[]) {
 const failValidation = () => {throw new Error('Please check your customer details and order selections.');};
 const hasText = (strValue,nMaximum) => typeof strValue==='string' && strValue.trim().length>0 && strValue.trim().length<=nMaximum;
 const objCustomer=objBody?.customer;
 if(!objCustomer || !hasText(objCustomer.firstName,80) || !hasText(objCustomer.lastName,80) || !hasText(objCustomer.email,254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(objCustomer.email.trim()) || typeof objCustomer.phone!=='string' || objCustomer.phone.length>14 || !/^$|^\([0-9]{3}\) [0-9]{3}-[0-9]{4}$/.test(objCustomer.phone)) failValidation();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objBody.requestKey || '')) failValidation();
 if(!Array.isArray(objBody.pizzas) || !objBody.pizzas.length || objBody.pizzas.length>30 || !Array.isArray(objBody.sides) || objBody.sides.length>20 || !Array.isArray(objBody.drinks) || objBody.drinks.length>20) failValidation();
 const getPrice = (strKind,strName) => {
  if(typeof strName!=='string') failValidation();
  const nPrice=mapMenu.get(`${strKind}:${strName}`);
  if(!Number.isSafeInteger(nPrice) || nPrice<0 || nPrice>1000000) failValidation();
  return nPrice;
 };
 const getQuantity = (nQuantity,nMaximum=10) => {
  if(!Number.isInteger(nQuantity) || nQuantity<1 || nQuantity>nMaximum) failValidation();
  return nQuantity;
 };
 const arrItems=objBody.pizzas.map(objPizza=>{
  if(!objPizza || !Array.isArray(objPizza.toppings) || objPizza.toppings.length>12 || new Set(objPizza.toppings).size!==objPizza.toppings.length) failValidation();
  const nUnit=getPrice('pizza',objPizza.size)+objPizza.toppings.reduce((nSum,strName)=>nSum+getPrice('topping',strName),0);
  return {kind:'pizza',description:`${objPizza.size} pizza${objPizza.toppings.length?' with '+objPizza.toppings.join(', '):''}`,quantity:1,unit:nUnit};
 });
 for(const objSide of objBody.sides){
  if(!objSide) failValidation();
  let nUnit=getPrice('side',objSide.name);
  const arrSizes=arrSideVariations.filter(objVariation=>objVariation.name===objSide.name);
  const strSize=objSide.size??(arrSizes.some(objVariation=>objVariation.size==='Medium')?'Medium':'Regular');
  if(typeof strSize!=='string'||!strSize.length||strSize.length>20)failValidation();
  if(arrSizes.length){
   const objVariation=arrSizes.find(objSize=>objSize.size===strSize);
   if(!objVariation||Number(objVariation.is_active)!==1)failValidation();
   nUnit=Number(objVariation.price_cents);
   if(!Number.isSafeInteger(nUnit)||nUnit<=0||nUnit>1000000)failValidation();
  }else if(strSize!=='Regular')failValidation();
  arrItems.push({kind:'side',description:arrSizes.length?`${objSide.name} (${strSize})`:objSide.name,...(arrSizes.length?{size:strSize}:{}),quantity:getQuantity(objSide.quantity,99),unit:nUnit});
 }
 for(const objDrink of objBody.drinks){
  if(!objDrink || typeof objDrink.name!=='string') failValidation();
  const nFlavor=getPrice('drink_name',objDrink.name);
  arrItems.push({kind:'drink',description:`${objDrink.name} (${objDrink.size})`,quantity:getQuantity(objDrink.quantity),unit:getPrice('drink',objDrink.size)+nFlavor});
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
 const getQuantity=(nQuantity,nMaximum=10)=>{
  if(!Number.isInteger(nQuantity)||nQuantity<1||nQuantity>nMaximum) throw new Error(`Item quantity must be between 1 and ${nMaximum}.`);
  return nQuantity;
 };
 return arrItems.map(objItem=>{
  if(!objItem||typeof objItem.description!=='string'||objItem.description.length>200) throw new Error('Enter a valid item description.');
  const strDescription=objItem.description.trim();
  const nQuantity=getQuantity(objItem.quantity,objItem.kind==='side'?99:10);
  if(objItem.kind==='pizza'){
   const objMatch=strDescription.match(/^([A-Za-z0-9][A-Za-z0-9 '&-]{0,39}) pizza(?: with ([A-Za-z0-9 ,&'-]+))?$/i);
   if(!objMatch) throw new Error('Pizza format: Medium pizza with Cheese, Pepperoni.');
   const strSize=[...mapMenu.keys()].filter(strKey=>strKey.startsWith('pizza:')).map(strKey=>strKey.slice(6)).find(strName=>strName.toLowerCase()===objMatch[1].toLowerCase());
   if(!strSize)throw new Error('Choose a pizza size on the current menu.');
   const arrToppings=objMatch[2]?objMatch[2].split(',').map(strName=>strName.trim()):[];
   if(arrToppings.length>12||new Set(arrToppings.map(strName=>strName.toLowerCase())).size!==arrToppings.length) throw new Error('Each pizza can have up to twelve unique toppings.');
   const arrNormalized=arrToppings.map(strName=>{
    const strNameOnMenu=[...mapMenu.keys()].filter(strKey=>strKey.startsWith('topping:')).map(strKey=>strKey.slice(8)).find(strMenuName=>strMenuName.toLowerCase()===strName.toLowerCase());
    if(!strNameOnMenu) throw new Error('One or more toppings are not on the menu.');
    getPrice('topping',strNameOnMenu);
    return strNameOnMenu;
   });
   const strFinal=`${strSize} pizza${arrNormalized.length?' with '+arrNormalized.join(', '):''}`;
   return {kind:'pizza',description:strFinal,quantity:nQuantity,unit:getPrice('pizza',strSize)+arrNormalized.reduce((nSum,strName)=>nSum+getPrice('topping',strName),0)};
  }
  if(objItem.kind==='side'){
   return {kind:'side',description:strDescription,quantity:nQuantity,unit:getPrice('side',strDescription)};
  }
  if(objItem.kind==='drink'){
   const objMatch=strDescription.match(/^(.{1,60}) \((.{1,40})\)$/);
   if(!objMatch) throw new Error('Drink format: Dr Pepper (Large).');
   const strDrink=[...mapMenu.keys()].filter(strKey=>strKey.startsWith('drink_name:')).map(strKey=>strKey.slice(11)).find(strName=>strName.toLowerCase()===objMatch[1].trim().toLowerCase());
   const strSize=[...mapMenu.keys()].filter(strKey=>strKey.startsWith('drink:')).map(strKey=>strKey.slice(6)).find(strName=>strName.toLowerCase()===objMatch[2].trim().toLowerCase());
   if(!strDrink||!strSize)throw new Error('Choose a drink and size on the current menu.');
   return {kind:'drink',description:`${strDrink} (${strSize})`,quantity:nQuantity,unit:getPrice('drink',strSize)+getPrice('drink_name',strDrink)};
  }
  throw new Error('Choose pizza, side, or drink for every order item.');
 });
}
