/*****
 License
 --------------
 Copyright © 2020 Mojaloop Foundation
 The Mojaloop files are made available by the Mojaloop Foundation under the
 Apache License, Version 2.0 (the 'License') and you may not use these files
 except in compliance with the License. You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, the Mojaloop files
 are distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied. See the License for the specific language
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
  updateConsentCredential,
  generatePutConsentsRequest
} from '~/domain/consents/generateChallenge'
import { logger } from '~/shared/logger'
import * as validators from '~/domain/validators'
import { Enum } from '@mojaloop/central-services-shared'
import * as challenge from '~/lib/challenge'
import { Request, ResponseToolkit, ResponseObject } from '@hapi/hapi'
import { Context } from '~/server/plugins'
import { consentDB, scopeDB } from '~/lib/db'
import { Consent, ConsentCredential } from '~/model/consent'
import { convertScopesToExternal } from '~/lib/scopes'
import { Scope } from '~/model/scope'
import { thirdPartyRequest } from '~/lib/requests'
import { CredentialStatusEnum } from '~/model/consent/consent'
import {
  putConsentError,
  DatabaseError,
  RevokedConsentStatusError,
  InvalidInitiatorSourceError,
  ActiveConsentChallengeRequestError,
  ChallengeGenerationError,
  PutRequestCreationError, isMojaloopError
} from '~/domain/errors'
import SDKStandardComponents from '@mojaloop/sdk-standard-components'

/** Retrieves consent, validates request,
 *  generates challenge, updates consent db
 * and makes outgoing PUT consent/{ID} call
 */
export async function generateChallengeAndPutConsent (
  request: Request,
  id: string
): Promise<void> {
  try {
    // Fetch consent from database using ID
    let consent: Consent
    try {
      consent = await consentDB.retrieve(id)
    } catch (error) {
      logger.push({ error }).error('Error in retrieving consent')

      // Convert error to Mojaloop understood error
      throw new DatabaseError(id)
    }

    if (!validators.isConsentRequestInitiatedByValidSource(consent, request)) {
      throw new InvalidInitiatorSourceError(id)
    }

    // Revoked consent should NOT be touched
    if (consent.status === 'REVOKED') {
      throw new RevokedConsentStatusError(id)
    }

    // If there is no pre-existing challenge for the consent id
    // Generate one and update database
    if (!consent.credentialChallenge) {
      // Challenge generation
      let challengeValue: string
      try {
        challengeValue = await challenge.generate()
      } catch (error) {
        logger.push({ consent }).error('Error encountered while generating challenge')
        throw new ChallengeGenerationError(id)
      }

      // Updating credentials with generated challenge
      const credential: ConsentCredential = {
        credentialChallenge: challengeValue,
        credentialStatus: CredentialStatusEnum.PENDING,
        credentialType: 'FIDO',
        credentialPayload: null
      }

      consent = await updateConsentCredential(consent, credential)
    } else if (consent.credentialStatus === 'ACTIVE') {
      logger.push({ consent }).error('ACTIVE credential consent has requested challenge')
      throw new ActiveConsentChallengeRequestError(id)
    }

    // Retrieve Scopes
    let scopesRetrieved: Scope[]
    try {
      scopesRetrieved = await scopeDB.retrieveAll(id)
    } catch (error) {
      logger.push({ consent }).error('Error: scopeDB failed to retrieve scopes')
      // Convert error to Mojaloop understood error
      throw new DatabaseError(id)
    }
    const scopes = convertScopesToExternal(scopesRetrieved)

    // Outgoing call to PUT consents/{ID}
    // Build Request Body
    let requestBody: SDKStandardComponents.PutConsentsRequest
    try {
      requestBody = await generatePutConsentsRequest(consent, scopes)
    } catch (error) {
      logger.push({ consent }).error('Failed to create put consent request')
      // Convert error to Mojaloop understood error
      throw new PutRequestCreationError(id)
    }
    // Use sdk-standard-components library to send request
    await thirdPartyRequest.putConsents(
      consent.id, requestBody, request.headers[Enum.Http.Headers.FSPIOP.SOURCE])
  } catch (error) {
    logger.push({ error }).error(`Outgoing call NOT made to PUT consent/${id}`)
    if(isMojaloopError(error)) {
      const participantId = request.headers[Enum.Http.Headers.FSPIOP.SOURCE]
      await putConsentError(id, error, participantId)
    }
  }
}

/** The HTTP request `POST /consents/{ID}/generateChallenge` is used to create a
 * credential for the given Consent object. The `{ID}` in the URI should
 * contain the `{ID}` that was used in the `POST /consents`.
 * Called by a `PISP`to request a challenge from the `auth-service`, which
 * will be returned to the PISP via `PUT /consents/{ID}`
 */
export async function post (
  _context: Context, request: Request, h: ResponseToolkit): Promise<ResponseObject> {
  const id = request.params.ID

  // Asynchronously deals with validating request,
  //  generating challenge, updating consent db
  //  and making outgoing PUT consent/{ID} call
  generateChallengeAndPutConsent(request, id)
  // intentionally not await-ing we want to run it in background

  // Return Success code informing source: request received
  return h.response().code(Enum.Http.ReturnCodes.ACCEPTED.CODE)
}

export default {
  post
}
