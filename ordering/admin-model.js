export function parseEditedItems(strText) {
  return strText.split('\n').map(strLine => strLine.trim()).filter(Boolean).map(strLine => {
    const arrParts = strLine.split('|').map(strPart => strPart.trim());
    if (arrParts.length !== 3) throw new Error('Each item needs exactly three fields separated by |.');
    const nQuantity = Number(arrParts[2]);
    if (!Number.isInteger(nQuantity)) throw new Error('Quantities must be whole numbers.');
    return {kind: arrParts[0].toLowerCase(), description: arrParts[1], quantity: nQuantity};
  });
}
