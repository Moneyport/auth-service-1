/* istanbul ignore file */

/*
 * This flag is to ignore BDD testing
 * which will be addressed in the future in
 * ticket #354
 */

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
 * Gates Foundation
 - Name Surname <name.surname@gatesfoundation.com>

 - Abhimanyu Kapur <abhi.kapur09@gmail.com>
 - Ahan Gupta <ahangupta@google.com>

 --------------
 ******/
import { Request, ResponseToolkit, ResponseObject } from '@hapi/hapi'
import { Consent } from '~/model/consent'
import { Logger } from '@mojaloop/central-services-logger'
import {
  retrieveValidConsent,
  updateConsentCredential,
  putConsents, ConsentCredential,
  checkCredentialStatus
} from '~/domain/consents/{ID}'
import { IncorrectChallengeError, IncorrectStatusError } from '~/domain/errors'
import { verifySignature } from '~/lib/challenge'
import { NotFoundError } from '~/model/errors'
import { Enum } from '@mojaloop/central-services-shared'

export async function retrieveUpdateAndPutConsent (
  id: string,
  challenge: string,
  credentialStatus: string,
  signature: string,
  publicKey: string,
  requestCredentialId: string,
  request: Request): Promise<void> {
  try {
    const consent: Consent = await retrieveValidConsent(id, challenge)
    /* Checks if incoming credential status is of the correct form */
    checkCredentialStatus(credentialStatus, id)
    try {
      if (!verifySignature(challenge, signature, publicKey)) {
        Logger.push({ consentId: id })
        Logger.error('Invalid Challenge')
        /* TODO, make outbound call to PUT consents/{ID}/error
        to be addressed in ticket number 355 */
        return
      }
      const credential: ConsentCredential = {
        credentialId: requestCredentialId,
        credentialStatus: 'ACTIVE',
        credentialPayload: publicKey
      }
      await updateConsentCredential(consent, credential)

      /* Outbound PUT consents/{ID} call */
      putConsents(consent, signature, publicKey, request)
    } catch (error) {
      Logger.push(error)
      Logger.error('Error: Outgoing call with challenge credential NOT made to PUT consents/' + id)
      /* TODO, make outbound call to PUT consents/{ID}/error
      to be addressed in ticket number 355 */
      return
    }
  } catch (error) {
    if (error instanceof IncorrectChallengeError ||
      error instanceof IncorrectStatusError ||
      error instanceof NotFoundError) {
      Logger.push(error)
    }
    Logger.push(error)
    Logger.error('Error in retrieving consent.')
    /* TODO, make outbound call to PUT consents/{ID}/error
    to be addressed in ticket number 355 */
  }
}

export async function put (
  request: Request,
  h: ResponseToolkit): Promise<ResponseObject> {
  const id = request.params.id
  // @ts-ignore
  const requestPayloadCredential = request.payload.credential
  const [signature, publicKey, challenge, requestCredentialId, credentialStatus] = [
    requestPayloadCredential.challenge.signature,
    requestPayloadCredential.payload,
    requestPayloadCredential.challenge.payload,
    requestPayloadCredential.id,
    requestPayloadCredential.status
  ]
  retrieveUpdateAndPutConsent(id, challenge, credentialStatus, signature, publicKey, requestCredentialId, request)
  return h.response().code(Enum.Http.ReturnCodes.ACCEPTED.CODE)
}
