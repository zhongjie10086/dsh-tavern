import path from 'node:path'
import {cliOptions} from './lib/r5-candidate-tools.mjs'
import {recoveryPreflight} from './lib/r5-recovery-tools.mjs'
const a=cliOptions(process.argv.slice(2),['--home-copy','--output','--source-label','--offline-copy','--external-link-roots'])
if(!a['--home-copy']||!a['--output'])throw Error('Usage: node scripts/r5-recovery-preflight.mjs --home-copy OFFLINE_COPY --output NEW_PRIVATE_DIR --source-label UNIQUE_LABEL --offline-copy yes [--external-link-roots DIR'+path.delimiter+'DIR...]')
// Links inside the Home are recorded and never followed; a link that leaves the Home
// is accepted only into one of these explicitly declared fixed dependency roots.
const externalLinkRoots=a['--external-link-roots']===undefined?[]:a['--external-link-roots'].split(path.delimiter).filter(Boolean)
console.log(JSON.stringify(await recoveryPreflight({homeCopy:a['--home-copy'],output:a['--output'],sourceLabel:a['--source-label'],offlineCopy:a['--offline-copy']==='yes',externalLinkRoots}),null,2))
