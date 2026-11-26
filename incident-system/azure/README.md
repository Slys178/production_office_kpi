# Incident system on Azure

**Status: part 1 only (receiving reports). Not deployed, and not yet run against real Azure services.**
Still to build: incident log API, Microsoft sign-in, investigation uploads and signatures, and the
director email when an investigator rates severity High or Critical.

## What I.T. needs to create

| Resource | Used for |
|---|---|
| Function App (Node, a currently supported LTS, v4 programming model) | Runs `api/` |
| Storage account (public blob access off) | `Incidents` table and `incident-photos` container, created automatically |
| Communication Services + Email, with a sender domain | Notification emails |

## App settings (set in Azure, never in this repository)

| Name | Value |
|---|---|
| `STORAGE_CONNECTION` | Storage account connection string |
| `EMAIL_CONNECTION` | Communication Services connection string |
| `EMAIL_FROM` | Verified sender address |
| `EMAIL_SUPERVISORS`, `EMAIL_MANAGERS`, `EMAIL_DIRECTORS` | Group or individual addresses, separated by `;` |
| `INCIDENT_LOG_URL` | Link put in emails (optional) |

Keep secrets in Key Vault where policy requires it.

## Deploy and connect

1. In `api/`: `npm install`, `npm test`, then `func azure functionapp publish <app-name>`.
2. Function App > CORS: allow the address the report form is served from (origin only).
3. Put `https://<app-name>.azurewebsites.net/api/report` in `../report/report-config.js` -> `endpoint`.
4. Send a test Near Miss and a test with "ambulance = Yes"; check the table, photos and both emails.

## To decide before go-live

- **Open endpoint:** anyone with the address can send reports. The spam traps are basic. Consider
  limiting it to site network addresses, or putting rate limiting in front.
- **Retention and access** for personal and health data.
- Large phone photos: the form sends them uncompressed (10 MB limit each).
