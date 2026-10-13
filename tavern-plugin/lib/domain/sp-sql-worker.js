import {executeSpSqlWorker} from './sp-sql.js'
process.once('message',async ({data,source,options})=>{
 let message
 try{message={result:await executeSpSqlWorker(data,source,options)}}catch(error){message={error:{message:String(error.message||error),code:error.code}}}
 if(process.connected)process.send(message,()=>process.disconnect())
})
process.on('disconnect',()=>process.exit(0))