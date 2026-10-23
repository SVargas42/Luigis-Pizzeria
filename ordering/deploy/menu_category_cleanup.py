"""One-file menu category fix. Default is a read-only compatibility check."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import subprocess

strOld = "      for(const row of rows){if(row.category==='topping'){toppingChoices.push(row.name);objToppingPrices[row.name]=row.price_cents/100;}else if(row.category==='drink_name'){drinkChoices.push(row.name);prices.beverages[row.name]=row.price_cents/100;}else prices[{pizza:'pizza',side:'sides',drink:'drinks'}[row.category]][row.name]=row.price_cents/100;}"
strNew = "      const mapMenuPriceGroups=new Map([['pizza',prices.pizza],['side',prices.sides],['drink',prices.drinks]]);\n      for(const objMenuRow of rows){\n        if(objMenuRow.category==='topping'){toppingChoices.push(objMenuRow.name);objToppingPrices[objMenuRow.name]=objMenuRow.price_cents/100;}\n        else if(objMenuRow.category==='drink_name'){drinkChoices.push(objMenuRow.name);prices.beverages[objMenuRow.name]=objMenuRow.price_cents/100;}\n        else{\n          // Custom admin categories have no checkout model yet; keep supported items available.\n          const objPriceGroup=mapMenuPriceGroups.get(objMenuRow.category);\n          if(objPriceGroup)objPriceGroup[objMenuRow.name]=objMenuRow.price_cents/100;\n        }\n      }"


def updated_source(strSource):
    if strSource.count(strOld) != 1:
        if strSource.count(strNew) == 1:
            return strSource
        raise ValueError('Expected menu-loading code not found; no files changed.')
    return strSource.replace(strOld, strNew, 1)


def main():
    objParser = argparse.ArgumentParser(description=__doc__)
    objParser.add_argument('--apply', action='store_true')
    objArgs = objParser.parse_args()
    objPath = Path('/opt/luigis/index.html')
    bufBefore = objPath.read_bytes()
    bufAfter = updated_source(bufBefore.decode('utf-8')).encode('utf-8')
    if bufBefore == bufAfter:
        print('Already applied.')
        return
    if not objArgs.apply:
        print('READY: index.html only; no files changed.')
        return
    strStamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    objBackup = objPath.with_name(objPath.name + '.bak-menu-category-' + strStamp)
    if objBackup.exists():
        raise FileExistsError(str(objBackup))
    subprocess.run(['cp', '--preserve=all', '--no-clobber', str(objPath), str(objBackup)], check=True)
    if objBackup.read_bytes() != bufBefore or objPath.read_bytes() != bufBefore:
        raise RuntimeError('Backup mismatch or concurrent change; no write performed.')
    try:
        objPath.write_bytes(bufAfter)
        if objPath.read_bytes() != bufAfter:
            raise RuntimeError('Write verification failed.')
    except Exception:
        objPath.write_bytes(bufBefore)
        raise
    print('BACKUP', objBackup)
    print('UPDATED', objPath)


if __name__ == '__main__':
    main()
