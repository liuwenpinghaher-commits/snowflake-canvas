// 保存前校验每一条带 xml 的流程。失败只写进 validation，不挡住落盘。

import { extraFlowRules, xmlToBeta } from './flow-project.mjs'

function failureMessage(error) {
  if (error instanceof Error && error.message) return error.message
  const text = String(error ?? '')
  return text || '校验没有完成'
}

function stampFailure(flow, error) {
  flow.validation = {
    ranAt: new Date().toISOString(),
    valid: false,
    errors: [{ ruleId: 'snowflake.validate-failed', message: failureMessage(error) }],
    warnings: [],
  }
}

// 上游要求第一行非注释内容是 bpmn-beta。投影结果没有这行，只在调用 vendor 前补上，不写回 beta。
function withBpmnBetaHeader(beta) {
  const text = String(beta).replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    if (line === 'bpmn-beta') return text
    return `bpmn-beta\n${text}`
  }
  return 'bpmn-beta'
}

function vendorError(issue) {
  const out = {
    ruleId: typeof issue?.ruleId === 'string' ? issue.ruleId : 'snowflake.validate-failed',
    message: typeof issue?.message === 'string' ? issue.message : String(issue?.message ?? ''),
  }
  if (typeof issue?.element === 'string') out.elementId = issue.element
  return out
}

function extraError(issue) {
  const out = {
    ruleId: typeof issue?.ruleId === 'string' ? issue.ruleId : 'snowflake.validate-failed',
    message: typeof issue?.message === 'string' ? issue.message : String(issue?.message ?? ''),
  }
  if (typeof issue?.elementId === 'string') out.elementId = issue.elementId
  return out
}

function vendorWarning(issue) {
  const out = {
    message: typeof issue?.message === 'string' ? issue.message : String(issue?.message ?? ''),
  }
  if (typeof issue?.ruleId === 'string') out.ruleId = issue.ruleId
  if (typeof issue?.element === 'string') out.elementId = issue.element
  return out
}

function usableXml(flow) {
  return Boolean(flow) && typeof flow === 'object' && typeof flow.xml === 'string' && flow.xml.length > 0
}

async function loadValidator() {
  const mod = await import('./vendor/validate-bpmn-beta.mjs')
  if (typeof mod.validateBpmnBeta !== 'function') throw new Error('validateBpmnBeta 没有导出')
  return mod.validateBpmnBeta
}

export async function validateDocumentFlows(document) {
  const flows = document && Array.isArray(document.flows) ? document.flows : null
  if (!flows) return
  const pending = flows.filter(usableXml)
  if (pending.length === 0) return
  let validateBpmnBeta
  try {
    validateBpmnBeta = await loadValidator()
  } catch (error) {
    for (const flow of pending) stampFailure(flow, error)
    return
  }
  for (const flow of pending) {
    try {
      const beta = xmlToBeta(flow.xml)
      flow.beta = typeof beta === 'string' ? beta : String(beta ?? '')
      const vendor = validateBpmnBeta(withBpmnBetaHeader(flow.beta))
      const extra = extraFlowRules(flow.beta)
      const errors = [
        ...(Array.isArray(vendor?.errors) ? vendor.errors.map(vendorError) : []),
        ...(Array.isArray(extra?.errors) ? extra.errors.map(extraError) : []),
      ]
      const warnings = Array.isArray(vendor?.warnings) ? vendor.warnings.map(vendorWarning) : []
      flow.validation = {
        ranAt: new Date().toISOString(),
        valid: errors.length === 0,
        errors,
        warnings,
      }
    } catch (error) {
      stampFailure(flow, error)
    }
  }
}
