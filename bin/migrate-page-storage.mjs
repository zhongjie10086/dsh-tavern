import {initializePageRetentionHome,upgradePageRetention} from '../tavern-plugin/lib/domain/page-retention-upgrade.js'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {rehearsePageHomeMigration} from '../scripts/lib/r16-page-home-rehearsal.mjs'
import {recoverPageMigration} from '../tavern-plugin/lib/domain/page-chat-migration.js'

export async function pageStorageCommand(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:{help:{type:'boolean'},'upgrade-data':{type:'string'},'expected-marker-sha256':{type:'string'},'initialize-data':{type:'string'},'retention-format5':{type:'boolean'},backup:{type:'string'},'manifest-sha256':{type:'string'},output:{type:'string'},boot:{type:'string'},'source-label':{type:'string'},'offline-copy':{type:'boolean'},'old-processes-stopped':{type:'boolean'},'recover-data':{type:'string'},'migration-id':{type:'string'},'receipt-sha256':{type:'string'},'relocate-from':{type:'string'},publish:{type:'boolean'}}})
 if(values.help)return {usage:['node bin/migrate-page-storage.mjs --initialize-data <new-empty-data-dir> --offline-copy --old-processes-stopped','node bin/migrate-page-storage.mjs --upgrade-data <format4-data-copy> --expected-marker-sha256 <sha256> --offline-copy --old-processes-stopped','Add --retention-format5 to an existing --backup/--output migration or --recover-data ... --publish command to upgrade its published output.']}
 if(values['offline-copy']!==true||values['old-processes-stopped']!==true)throw Error('Requires --offline-copy and --old-processes-stopped attestations. Never target a live Home.')
 if(values['initialize-data']||values['upgrade-data']){
  if(values['initialize-data']&&values['upgrade-data']||['backup','output','recover-data','retention-format5'].some(key=>values[key]))throw Error('Initialization/upgrade cannot be mixed with migration or recovery')
  if(values['initialize-data'])return initializePageRetentionHome(values['initialize-data'])
  if(!/^[a-f0-9]{64}$/.test(values['expected-marker-sha256']||''))throw Error('Upgrade requires --expected-marker-sha256 of the format4 marker')
  return upgradePageRetention(values['upgrade-data'],{expectedMarkerSha256:values['expected-marker-sha256']})
 }
 if(values['recover-data']&&['backup','manifest-sha256','output','boot','source-label'].some(key=>values[key]))throw Error('Recovery and fresh Home migration options cannot be mixed')
 if(!values['recover-data']&&['migration-id','receipt-sha256','relocate-from','publish'].some(key=>values[key]!==undefined))throw Error('Recovery options require --recover-data')
 if(values['recover-data']){const result=await recoverPageMigration({dataRoot:values['recover-data'],migrationId:values['migration-id'],expectedReceiptSha256:values['receipt-sha256'],relocateFrom:values['relocate-from'],publish:values.publish===true,offlineCopy:true,oldProcessesStopped:true});if(values['retention-format5']){if(!values.publish)throw Error('--retention-format5 recovery requires --publish');result.retention=await upgradePageRetention(values['recover-data'])}return result}
 for(const key of ['backup','manifest-sha256','output','boot','source-label'])if(!values[key])throw Error('Missing --'+key)
 const result=await rehearsePageHomeMigration({backup:values.backup,manifestSha256:values['manifest-sha256'],output:values.output,bootModule:values.boot,sourceLabel:values['source-label'],offlineCopy:true,oldProcessesStopped:true})
 if(values['retention-format5'])result.retention=await upgradePageRetention(path.join(result.output,'home/profile-data/tavern/data'))
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await pageStorageCommand(),null,2))}catch(error){console.error(error.stack||error);process.exitCode=1}}
