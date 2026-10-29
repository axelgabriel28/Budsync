const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise')
const { defineString } = require('firebase-functions/params')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const logger = require('firebase-functions/logger')

const siteKey = defineString('RECAPTCHA_ENTERPRISE_SITE_KEY')
const minimumLoginScore = 0.5
const recaptchaClient = new RecaptchaEnterpriseServiceClient()

exports.assessLogin = onCall({
  region: 'asia-southeast1',
  enforceAppCheck: true,
}, async (request) => {
  const token = request.data?.token
  if (typeof token !== 'string' || token.length < 1 || token.length > 4096) {
    throw new HttpsError('invalid-argument', 'A valid sign-in verification token is required.')
  }

  try {
    const projectId = process.env.GCLOUD_PROJECT
    if (!projectId) throw new Error('Firebase project ID is unavailable.')

    const [assessment] = await recaptchaClient.createAssessment({
      parent: recaptchaClient.projectPath(projectId),
      assessment: {
        event: {
          token,
          siteKey: siteKey.value(),
          expectedAction: 'LOGIN',
          userAgent: request.rawRequest.get('user-agent') || undefined,
        },
      },
    })

    const properties = assessment.tokenProperties
    const score = assessment.riskAnalysis?.score
    return {
      allowed: Boolean(properties?.valid && properties.action === 'LOGIN' && typeof score === 'number' && score >= minimumLoginScore),
    }
  } catch (error) {
    logger.error('reCAPTCHA sign-in assessment failed')
    throw new HttpsError('unavailable', 'Sign-in verification is temporarily unavailable.')
  }
})
