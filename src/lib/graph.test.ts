import {describe,expect,it} from 'vitest'
import {compileGraph,graphKey,manifestGraph} from './graph'
import {initialManifest,canonicalManifest,compileIntent,validateManifest} from './strategy'
import {templateCatalog} from './workspace'
import {manifestToEngineConfig,manifestHash} from './contracts/engine'
describe('graph → manifest → Engine',()=>{
 it.each(templateCatalog.map(t=>[t.name,t.manifest] as const))('compiles %s to its exact authorized manifest',(_name,manifest)=>{
  const result=compileGraph(manifestGraph(manifest));expect(result.ok).toBe(true)
  if(result.ok){expect(canonicalManifest(result.manifest)).toBe(canonicalManifest(manifest));expect(manifestHash(result.manifest)).toBe(manifestHash(manifest));expect(manifestToEngineConfig(result.manifest)).toEqual(manifestToEngineConfig(manifest))}
 })
 it('requires all nodes and connections, including the loss and void branches',()=>{
  const graph=manifestGraph(initialManifest)
  for(const node of graph.nodes)expect(compileGraph({...graph,nodes:graph.nodes.filter(n=>n.id!==node.id)}).ok).toBe(false)
  for(let i=0;i<graph.edges.length;i++)expect(compileGraph({...graph,edges:graph.edges.filter((_,j)=>i!==j)}).ok).toBe(false)
 })
 it('rejects duplicate nodes, unsupported actions, extra edges and cycles that bypass STOP',()=>{
  const graph=manifestGraph(initialManifest)
  expect(compileGraph({...graph,nodes:[...graph.nodes,graph.nodes[0]]}).ok).toBe(false)
  expect(compileGraph({...graph,edges:[...graph.edges,{from:'roll',port:'next',to:'buy'}]}).ok).toBe(false)
  graph.nodes.find(n=>n.kind==='BUY')!.data.type='SELL'
  expect(compileGraph(graph).ok).toBe(false)
 })
 it('only layout changes leave the compilation key unchanged',()=>{
  const graph=manifestGraph(initialManifest);const key=graphKey(graph)
  graph.nodes[0].x=123;expect(graphKey(graph)).toBe(key)
  graph.nodes[0].data.asset='ETH';expect(graphKey(graph)).not.toBe(key)
 })
 it('rejects unsafe ladder sizing and repeated losses',()=>{
  const ladder=structuredClone(templateCatalog[1].manifest)
  ladder.policy.stopAfterConsecutiveLosses=2;expect(validateManifest(ladder).length).toBeGreaterThan(0)
  ladder.policy.stopAfterConsecutiveLosses=1;ladder.action.sizing!.initialCollateral='11';expect(compileGraph(manifestGraph(ladder)).ok).toBe(false)
 })
 it('extracts the Turkish intent without inventing missing limits',()=>{
  const draft=compileIntent('UP 70 cent’i geçerse DOWN al, iki kayıpta dur')
  expect(draft.trigger?.value).toBe('0.7');expect(draft.action?.type).toBe('BUY_DOWN');expect(draft.policy?.stopAfterConsecutiveLosses).toBe(2)
  expect(draft.action?.maxCollateral).toBeUndefined();expect(validateManifest(draft).length).toBeGreaterThan(0)
 })
})


it('parses explicit ladder sizing without falling back to a fixed order',()=>{
 const text='BTC 1h below 40%, buy UP. Ladder start with 5, increase by 2.5 after each win, max order 10. Stop after first loss. Capital 25, max 3 rounds, slippage 200 bps, expiry buffer 120.'
 const draft=compileIntent(text)
 expect(draft.action?.sizing).toEqual({mode:'WIN_LADDER',initialCollateral:'5',incrementCollateral:'2.5'})
 expect(validateManifest(draft)).toEqual([])
 expect(validateManifest(compileIntent(text.replace('increase by 2.5','increase'))).length).toBeGreaterThan(0)
})
