# Add volunteer review and deployment

This change needs both the V2 page and the existing Mekorvim V2 Apps Script web app. Merging the page alone does not enable the feature: the Add volunteer button stays hidden until the server returns `features.addVolunteer: true`.

## Before deployment

1. Obtain owner approval for the final page and server changes.
2. Back up the current Apps Script source and private State store. Keep all data and account rows out of this repository.
3. Compare the current Apps Script source with this reviewed `Code.gs`. Stop if another change landed since review. Preserve DB_ID and existing account rows.
4. Run `node *add-volunteer.test.cjs`. The test uses synthetic in-memory data and does not call a live service.

## Deploy after approval

1. Replace the existing V2 project's Code source with the reviewed `Code.gs`. Do not create or replace any Yoga Bamidbar project.
2. Save, then use Deploy > Manage deployments > Edit to create a new version of the existing web-app deployment. Keep its access settings and URL unchanged.
3. Merge the approved page change, and wait for GitHub Pages deployment.
4. Read the web app with an existing coordinator session. Confirm the addVolunteer capability and unchanged revision/data before adding anybody.
5. Verify the Add volunteer card in the live page. Do not create a fake volunteer in the real store. Real additions must be chosen by a coordinator.

## Behavior and limits

- Additions are coordinator-only, revision-checked and covered by the existing script lock.
- Name and at least one period and available date are required. Phone and coordinator note are optional. Phone numbers are normalized and exact duplicate phone numbers are blocked.
- Similar names require a separate review checkbox. Different people with the same name may be added after review; records are never auto-merged.
- The person gets a new stable ID, period membership and planned availability. No shift, attendance confirmation, account or token is created.
- Private phone, note and availability fields are removed from other volunteers' projections. IDs such as national identity numbers are not requested or stored by this feature.
- The roster remains based on assignments, not verified on-site attendance.
- Creating a personal link is a separate existing action and still requires a valid phone. Opening the link action does not send anything.
- If the outcome of a save is uncertain, refresh and look for the person before trying again. There is no automatic write retry.

## Rollback

Restore the previous Apps Script version to hide the capability. Restore the page commit if needed. Preserve any real people already added; restoring an old State backup would remove their additions and must not be done without a reviewed recovery plan.
