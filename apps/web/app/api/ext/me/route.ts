import { NextRequest } from 'next/server'
import { extError, extJson, preflight, requireExtensionUser } from '../../../../lib/ext'

export async function OPTIONS(req: NextRequest) { return preflight(req) }

/** Connection check for the options page. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireExtensionUser(req)
    return extJson(req, { user: { id: user.id, email: user.email, name: user.name }, app: { name: 'JobRadar', version: process.env.APP_VERSION ?? 'dev' } })
  } catch (err) {
    return extError(req, err)
  }
}
