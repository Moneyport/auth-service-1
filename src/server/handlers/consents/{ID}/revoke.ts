/*****
 License
 --------------
 Copyright © 2020 Mojaloop Foundation
 The Mojaloop files are made available by the Mojaloop Foundation under the
 Apache License, Version 2.0 (the 'License') and you may not use these files
 except in compliance with the License. You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, the Mojaloop
 files are distributed onan 'AS IS' BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 ANY KIND, either express or implied. See the License for the specific language
 governing permissions and limitations under the License.
 Contributors
 --------------
 This is the official list of the Mojaloop project contributors for this file.
 Names of the original copyright holders (individuals or organizations)
 should be listed with a '*' in the first column. People who have
 contributed from an organization can be listed under the organization
 that actually holds the copyright for their contributions (see the
 Gates Foundation organization for an example). Those individuals should have
 their names indented and be marked with a '-'. Email address can be added
 optionally within square brackets <email>.

 - Abhimanyu Kapur <abhi.kapur09@gmail.com>
 - Paweł Marzec <pawel.marzec@modusbox.com>
 --------------
 ******/
import {
  generatePatchRevokedConsentRequest,
  revokeConsentStatus
} from '~/domain/consents/revoke'
import * as validators from '~/domain/validators'
import { Context } from '~/server/plugins'
import { Request, ResponseToolkit, ResponseObject } from '@hapi/hapi'
import { logger } from '~/shared/logger'
import { Enum } from '@mojaloop/central-services-shared'
import { consentDB } from '~/lib/db'
import { Consent } from '~/model/consent'
import { thirdPartyRequest } from '~/lib/requests'
import {
  putConsentError,
  DatabaseError,
  InvalidInitiatorSourceError, isMojaloopError
} from '~/domain/errors'

/**
 * Asynchronously deals with validating request, revoking consent object
 * and send outgoing PATCH consent/{id}/revoke request to switch
 */
export async function validateRequestAndRevokeConsent (
  request: Request): Promise<void> {
  const consentId = request.params.ID

  try {
    // Fetch consent from database using ID
    let consent: Consent
    try {
      consent = await consentDB.retrieve(consentId)
    } catch (error) {
      logger.push({ error }).error('Error in retrieving consent')

      // After logging, convert specific error to generic DatabaseError
      throw new DatabaseError(consentId)
    }

    // If request is not intiated by valid source, send PUT ...error back
    if (!validators.isConsentRequestInitiatedByValidSource(consent, request)) {
      throw new InvalidInitiatorSourceError(consentId)
    }

    // If Consent is ACTIVE, revoke it and update database. If already revoked, leave it alone but don't throw an error.
    consent = await revokeConsentStatus(consent)

    // Outgoing call to PATCH consents/{ID}/revoke
    const requestBody = generatePatchRevokedConsentRequest(consent)
    await thirdPartyRequest.patchConsents(
      consent.id,
      requestBody,
      request.headers[Enum.Http.Headers.FSPIOP.SOURCE]
    )
  } catch (error) {
    logger.push({ error }).error(`Outgoing call NOT made to PUT consent/${consentId}/revoke`)
    if(isMojaloopError(error)) {
      const participantId = request.headers[Enum.Http.Headers.FSPIOP.SOURCE]
      await putConsentError(consentId, error, participantId)
    }
  }
}

/**
 * The HTTP request `POST /consents/{id}/revoke` is used to revoke a consent
 * object - Called by either a PISP or DFSP
 */
export async function post (
  _context: Context,
  request: Request,
  h: ResponseToolkit): Promise<ResponseObject> {
  // Asynchronously validate request and revoke consent
  validateRequestAndRevokeConsent(request)

  // Return Success code informing source: request received
  return h.response().code(Enum.Http.ReturnCodes.ACCEPTED.CODE)
}

export default {
  post
}
