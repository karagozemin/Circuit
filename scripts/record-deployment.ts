import { readFile,writeFile } from 'node:fs/promises'
import { createPublicClient,fallback,http,keccak256,type Hex } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL } from '../src/lib/dreamdex/config'
const deployment=JSON.parse(await readFile(process.argv[2] ?? 'deployments/evidence/engine-handler-2026-09-06.json','utf8'))
const preparation=JSON.parse(await readFile(process.argv[3] ?? 'deployments/evidence/live-preparation.json','utf8'))
const old=JSON.parse(await readFile('deployments/shannon.json','utf8'))
const client=createPublicClient({chain:somniaShannon,transport:fallback([SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL].map(url=>http(url)))})
const transactions:Record<string,unknown>={}
for (const [kind,hash] of Object.entries(deployment.transactions)) {
 const receipt=await client.getTransactionReceipt({hash:hash as Hex})
 if (receipt.status!=='success') throw new Error(`${kind} failed`)
 transactions[kind]={hash,blockNumber:Number(receipt.blockNumber)}
}
const codeHashes:Record<string,unknown>={}
for (const kind of ['engine','handler','smartAccount']) {
 const code=await client.getCode({address:deployment[kind]})
 if (!code || code==='0x') throw new Error(`${kind} has no code`)
 codeHashes[kind]=keccak256(code)
}
const output={network:'Somnia Shannon Testnet',chainId:50312,deployedAt:new Date().toISOString(),admin:deployment.admin,engine:deployment.engine,handler:deployment.handler,smartAccount:deployment.smartAccount,transactions,codeHashes,
 preparation:{strategyId:preparation.strategyId,status:'VALIDATED — not activated',marketId:preparation.market.marketId,smartAccountBalance:preparation.smartAccountBalance,allowance:preparation.allowance,allowanceSpender:preparation.market.pool,collateral:preparation.market.collateral,collateralDecimals:6,subscriptions:preparation.subscriptions,verifiedAt:preparation.verifiedAt,evidence:process.argv[3] ?? 'deployments/evidence/live-preparation.json'},
 liveLifecycle:{complete:false,callbackEvidence:null,orderEvidence:null,resolutionEvidence:null,reason:'No complete live lifecycle proof recorded yet. See the preparation/evidence files for the current stage.'},
 dreamDexBinaryPoolAuthorization:'not required for the linked smart-account direct order path',previousDeployments:[old]}
await writeFile('deployments/shannon.json',JSON.stringify(output,null,2)+'\n')
// Only public deployment variables change. The private key remains in its ignored file, untouched.
const envPath='.env.local'
let env=await readFile(envPath,'utf8')
for (const [name,value] of Object.entries({VITE_CIRCUIT_ENGINE_ADDRESS:deployment.engine,VITE_CIRCUIT_HANDLER_ADDRESS:deployment.handler,VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS:deployment.smartAccount})) {
 const line=`${name}=${value}`
 env=new RegExp(`^${name}=.*$`,'m').test(env)?env.replace(new RegExp(`^${name}=.*$`,'m'),line):`${env.trimEnd()}\n${line}\n`
}
await writeFile(envPath,env,{mode:0o600})
console.log(JSON.stringify({engine:deployment.engine,handler:deployment.handler,smartAccount:deployment.smartAccount,transactions,liveLifecycleComplete:false}))
