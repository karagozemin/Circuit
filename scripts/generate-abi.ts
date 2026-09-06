import { readFile, writeFile } from 'node:fs/promises'
const { abi } = JSON.parse(await readFile('contracts/out/CircuitEngine.sol/CircuitEngine.json','utf8'))
const subset = abi.filter((entry: {type:string;name?:string}) => entry.type === 'event' || ['getStrategy','syncStrategy'].includes(entry.name ?? ''))
await writeFile('src/lib/contracts/lifecycle-abi.ts', '// Generated from CircuitEngine artifact by scripts/generate-abi.ts.\nexport const lifecycleAbi = '+JSON.stringify(subset)+' as const\n')
