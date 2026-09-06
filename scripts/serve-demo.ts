/** Read-only, loopback-only evidence viewer. Serves no workspace or environment files. */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Circuit · Live Shannon evidence</title>
<style>*{box-sizing:border-box}body{margin:0;background:#101514;color:#e9f1ea;font:16px system-ui;padding:44px}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:36px;margin:8px 0}h2{font-size:22px}small,.muted{color:#a2b6a9}#badge{color:#acff97}#steps{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:24px 0}.step{padding:18px 12px;border:1px solid #344d3a;border-radius:12px;background:#19221c;min-height:104px}.step.done{border-color:#95ef79}.step strong{display:block;font-size:14px}.step span{display:block;margin-top:12px;color:#8dae96;font-size:12px}a{color:#b2f391}#metrics{display:flex;gap:44px;margin:22px 0;padding:18px;background:#19221c;border-radius:12px}#metrics strong{display:block;font-size:24px}#events{max-height:260px;overflow:auto}article{display:flex;justify-content:space-between;border-bottom:1px solid #273a2c;padding:9px 0;font-size:13px}footer{margin-top:20px;font-size:12px;color:#9caf9f}code{font-size:12px}#error{color:#ffb892}</style>
<header><div><small>CIRCUIT / VERIFIED TESTNET EXECUTION</small><h1>One strategy. A real live cycle.</h1></div><div><b id="badge">Loading evidence</b><p id="clock" class="muted"></p></div></header>
<p id="strategy"></p><div id="steps"></div><div id="metrics"></div><h2 id="stage"></h2><p id="error"></p><div id="events"></div><footer id="foot"></footer>
<script>
const stages=[['Activation','StrategyActivated'],['Callback','TriggerMatched'],['Order + fill','OrderExecuted'],['Resolution + redeem','RoundResolved'],['Rollover','RolloverComputed'],['Successor armed','MarketBound']];
function node(tag,text){const el=document.createElement(tag);el.textContent=text;return el}
async function update(){try{const response=await fetch('/proof.json',{cache:'no-store'});if(!response.ok)throw Error('Evidence is not available yet');const p=await response.json();window.circuitProof=p;
document.getElementById('badge').textContent=p.complete?'LIVE CYCLE VERIFIED':'LIVE CYCLE IN PROGRESS';
document.getElementById('clock').textContent=new Date().toLocaleString('en-GB')+' · Shannon 50312';
document.getElementById('strategy').textContent=p.manifest.name+' · '+p.manifest.series.asset+' '+p.manifest.series.intervalSec/60+'m · max order '+p.manifest.action.maxCollateral+' tUSDC · hard cap '+p.manifest.policy.maxTotalCapitalAtRisk+' tUSDC';
const steps=document.getElementById('steps');steps.replaceChildren();for(const [label,event] of stages){const done=event==='StrategyActivated'?!!p.transactions.activation:event==='MarketBound'?p.runtime?.round>=2:p.events.some(e=>e.name===event);const el=node('div','');el.className='step'+(done?' done':'');el.append(node('strong',label),node('span',done?'Verified on-chain':'Pending'));steps.append(el)}
const metrics=document.getElementById('metrics');metrics.replaceChildren();for(const [label,value] of [['Round',p.runtime?.round??1],['Capital used',Number(p.runtime?.cumulativeCapitalUsed??0)/1e6+' tUSDC'],['Tracked position',Number(p.runtime?.currentPositionSize??0)/1e6+' shares'],['Window close',new Date(p.market.expiry*1000).toLocaleTimeString('en-GB')]]){const el=node('div',label);el.append(node('strong',value));metrics.append(el)}
document.getElementById('stage').textContent=p.stage;document.getElementById('error').textContent=p.error??'';
const list=document.getElementById('events');list.replaceChildren();const selected=new Set(['StrategyActivated','TriggerMatched','ReactivityCallbackProcessed','OrderExecuted','RoundResolved','RolloverComputed','MarketBound','StrategyPaused','StrategyResumed']);for(const e of p.events.filter(e=>selected.has(e.name)).slice().reverse()){const row=node('article',e.name+' · block '+e.blockNumber);const link=node('a',e.hash.slice(0,16)+'…');link.href='https://shannon-explorer.somnia.network/tx/'+e.hash;link.target='_blank';row.append(link);list.append(row)}
document.getElementById('foot').textContent='Real protocol receipts; test collateral. '+p.liquidityDisclosure+' Strategy: '+p.strategyId;
}catch(e){document.getElementById('error').textContent=e.message}}update();setInterval(update,3000);
</script></html>`
const server=createServer(async(request,response)=>{
 try {
  if(request.url==='/proof.json'){response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');const proof=JSON.parse(await readFile('deployments/evidence/live-demo/proof.json','utf8'));response.end(JSON.stringify({...proof,historicalError:proof.error,error:proof.stage.startsWith('blocked')?proof.error:undefined}));return}
  if(request.url==='/' || request.url==='/index.html'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return}
  response.statusCode=404;response.end('Not found')
 }catch{response.statusCode=503;response.end('Evidence not ready')}
})
if(process.argv.includes('--export')){
 const proof=JSON.parse(await readFile('deployments/evidence/live-demo/proof.json','utf8'))
 if(!proof.complete)throw new Error('Export requires a completed lifecycle.')
 const embedded=JSON.stringify(proof).replace(/</g,'\\u003c')
 const snapshot=html.replace("const response=await fetch('/proof.json',{cache:'no-store'});if(!response.ok)throw Error('Evidence is not available yet');const p=await response.json();",'const p='+embedded+';').replace("new Date().toLocaleString('en-GB')","new Date(p.completedAt).toLocaleString('en-GB')")
 await writeFile('deployments/evidence/live-demo/index.html',snapshot)
 console.log('Exported standalone receipt viewer.')
}else server.listen(8788,'127.0.0.1',()=>console.log('Read-only live evidence: http://127.0.0.1:8788'))
