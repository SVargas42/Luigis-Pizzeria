# Menu API: Phase B

Implemented and tested locally; not deployed. Production currently has only
the Phase A schema/grant changes. Frontend confirmation and description fields
remain Phase C work. No production source files or service restarts were used
to implement this phase.

## Public contract

All routes require Node's verified, enabled administrator account session.
Mutation requests require the exact configured website Origin and a JSON object
within the existing 32 KB body limit. Node forwards only to a numeric loopback
HTTP origin, overwrites client credentials/actor headers, and rejects redirects.
FastAPI additionally requires the existing internal Basic service credentials.
Those internal credentials are not website administrator accounts.

| Method | Path | JSON body | Success |
| --- | --- | --- | --- |
| GET | /api/admin/menu | None | 200, array including inactive items |
| POST | /api/admin/menu | category, name, priceCents, optional description | 201, created item |
| PATCH | /api/admin/menu/{category}/{name} | name, priceCents, optional description | 200, updated item |
| DELETE | /api/admin/menu/{category}/{name} | confirmation | 200, inactive item |

URL-encode item names. Categories are pizza, topping, side, drink and drink_name.
Names retain the existing 60-character ASCII letter/number/space/apostrophe/&/-
contract; descriptions allow up to 1000 characters. Prices must be integer cents
from 0 to 1000000. Only drink_name allows zero as a price adjustment. Extra body
fields are rejected. Responses use category, name, description, price_cents and
is_active (the delete response includes category/name/is_active only).

PATCH preserves description when omitted by the older dashboard. An explicit
empty string clears it. It updates only an active row and succeeds for unchanged
values. Existing inactive names remain reserved within the category (409).

DELETE requires, for example:

```json
{"confirmation":"DELETE Pepperoni"}
```

The exact phrase is checked against the database name while its row is locked,
including capitalization and spacing. It updates is_active only; no order,
receipt or other historical data is deleted. Missing/inactive/stale targets
return 404; invalid input/confirmation returns 422; duplicates return 409.
Transactions roll back on failure. Backend outages return 503 without internal
details. Frontend phases must render stored text through textContent.

## Checkout compatibility

Pickup checkout validates item names against the active database catalogue,
replacing fixed Python name/size enums. New and renamed pizza sizes, sides,
drink sizes and drink names can now be ordered. Side quantity validation matches
the existing frontend's limit of 99. Phase A active filtering remains in place
for the customer menu, pickup pricing, Stripe quotes and legacy order editing.
Previously quoted Stripe payments and historical receipt retries are unchanged.

## Verification and deployment boundary

- Node suite: 86 passed; 3 live MariaDB tests skipped.
- Python suite: 47 passed using isolated SQLite; existing deprecation warnings remain.
- Tests cover account-role denial and forged headers, internal credentials,
  Origin checks, exact confirmation, validation, duplicate/removed names,
  create/update/delete rollback, dynamic checkout choices and history retention.
- No live authenticated admin workflow has been tested: the last inspected
  production accounts table was empty. Provisioning belongs to the account work.
- A production release needs the cumulative Phase A/B runtime files:
  ordering/server.js, ordering/payments.js, ordering/menu-proxy.js,
  ordering/lifecycle/app.py and ordering/lifecycle/menu_queries.py.
  Production migration 005 and menu runtime grants are already applied.
- Before replacing those files, recheck for teammate changes, back up each
  existing target, and present the exact copy/install commands for approval.
  Both luigis.service and luigis-lifecycle.service require separately approved
  restart commands. No Nginx change is needed.
