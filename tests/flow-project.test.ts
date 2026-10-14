import { describe, expect, it } from 'vitest'
import { betaToXml, extraFlowRules, xmlToBeta } from '../server/flow-project.mjs'

const gatewayXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="Definitions_1">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Participant_1" name="池" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="泳道">
        <bpmn:flowNodeRef>s1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="s1" name="开始" />
    <bpmn:task id="t1" name="做事" />
    <bpmn:exclusiveGateway id="g1" name="判断" default="Flow_default" />
    <bpmn:endEvent id="e1" name="结束" />
    <bpmn:endEvent id="e2" name="另一结束" />
    <bpmn:sequenceFlow id="Flow_s_t" sourceRef="s1" targetRef="t1" />
    <bpmn:sequenceFlow id="Flow_t_g" sourceRef="t1" targetRef="g1" />
    <bpmn:sequenceFlow id="Flow_cond" name="条件甲" sourceRef="g1" targetRef="e1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">表达式正文</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_default" sourceRef="g1" targetRef="e2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Shape_s1" bpmnElement="s1">
        <dc:Bounds x="100" y="80" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_cond" bpmnElement="Flow_cond">
        <di:waypoint x="10" y="20" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const gatewayBeta = [
  'start s1 "开始"',
  'task t1 "做事"',
  'xor g1 "判断"',
  'end e1 "结束"',
  'end e2 "另一结束"',
  's1 --> t1',
  't1 --> g1',
  'g1 --> e1: "条件甲"',
  'g1 --> e2: "其余"',
].join('\n')

function readAttr(chunk: string, name: string) {
  const matched = chunk.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))
  return matched?.[1] ?? ''
}

function sequenceFlows(xml: string) {
  return [...xml.matchAll(/<bpmn:sequenceFlow\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bpmn:sequenceFlow>)/g)].map((matched) => ({
    attrs: matched[1],
    inner: matched[2] ?? '',
    id: readAttr(matched[1], 'id'),
    source: readAttr(matched[1], 'sourceRef'),
    target: readAttr(matched[1], 'targetRef'),
  }))
}

describe('流程 XML 与 bpmn-beta', () => {
  it('一条条件加一条 default 的网关', () => {
    const beta = xmlToBeta(gatewayXml)
    expect(beta).toBe(gatewayBeta)
    expect(beta).not.toContain('表达式正文')
    expect(beta).not.toContain('==>')
    expect(beta).not.toContain('waypoint')
    expect(beta).not.toContain('泳道')

    const xml = betaToXml(beta)
    expect(xml).toContain('xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"')
    expect(xml).toContain('<bpmn:process id="Process_1" isExecutable="false">')
    const gateway = xml.match(/<bpmn:exclusiveGateway\b([^>]*?)\/>/)
    expect(gateway).toBeTruthy()
    const defaultId = readAttr(gateway?.[1] ?? '', 'default')
    expect(defaultId).toBe('Flow_g1_e2_1')

    const flows = sequenceFlows(xml)
    const pointed = flows.find((flow) => flow.id === defaultId)
    expect(pointed?.source).toBe('g1')
    expect(pointed?.target).toBe('e2')
    expect(pointed?.inner).not.toContain('conditionExpression')

    const conditional = flows.find((flow) => flow.source === 'g1' && flow.target === 'e1')
    expect(conditional?.id).toBe('Flow_g1_e1_1')
    expect(conditional?.inner).toContain('<bpmn:conditionExpression>条件甲</bpmn:conditionExpression>')

    expect(xmlToBeta(xml)).toBe(beta)
  })

  it('孤立任务从起点走不到终点', () => {
    const beta = ['start s "开始"', 'end e "结束"', 'task alone "孤立"', 's --> e'].join('\n')
    const { errors } = extraFlowRules(beta)
    expect(errors).toEqual([
      {
        ruleId: 'snowflake.unreachable-end',
        message: '从起点走不到终点：alone',
        elementId: 'alone',
      },
    ])
  })

  it('自环只报一次', () => {
    const beta = ['task a "甲"', 'a --> a', 'a --> a'].join('\n')
    const { errors } = extraFlowRules(beta)
    expect(errors).toEqual([
      {
        ruleId: 'snowflake.self-loop',
        message: 'a 连回了自己',
        elementId: 'a',
      },
    ])
  })

  it('没有终点时起点和任务都走不到终点', () => {
    const beta = ['start s "开始"', 'task t "做事"', 's --> t'].join('\n')
    const { errors } = extraFlowRules(beta)
    expect(errors.map((error) => error.ruleId)).toEqual(['snowflake.unreachable-end', 'snowflake.unreachable-end'])
    expect(errors.map((error) => error.elementId)).toEqual(['s', 't'])
    for (const error of errors) expect(error.message).toContain('从起点走不到终点')
  })

  it('同一网关两条其余会抛错', () => {
    const beta = ['xor g1 "判断"', 'end e1 "甲"', 'end e2 "乙"', 'g1 --> e1: "其余"', 'g1 --> e2: "其余"'].join('\n')
    expect(() => betaToXml(beta)).toThrow(/网关 g1 有两条「其余」/)
  })

  it('默认命名空间、空名称和任务子类型', () => {
    const xml = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="Process_1" isExecutable="false">
    <startEvent id="s1" />
    <userTask id="u1" name="审批" />
    <serviceTask id="v1" name="调用" />
    <parallelGateway id="p1" name="并行" />
    <inclusiveGateway id="o1" name="相容" />
    <endEvent id="e1" name="" />
    <sequenceFlow id="f1" sourceRef="s1" targetRef="u1" />
    <sequenceFlow id="f2" sourceRef="p1" targetRef="o1">
      <conditionExpression><![CDATA[走这边]]></conditionExpression>
    </sequenceFlow>
  </process>
</definitions>`
    expect(xmlToBeta(xml)).toBe(
      [
        'start s1',
        'task u1 "审批"',
        'task v1 "调用"',
        'and p1 "并行"',
        'or o1 "相容"',
        'end e1',
        's1 --> u1',
        'p1 --> o1: "走这边"',
      ].join('\n'),
    )
  })
})
