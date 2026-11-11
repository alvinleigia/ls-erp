/* eslint-disable @typescript-eslint/no-require-imports */
// Test transport only: Chrome already resolves *.localhost to loopback, while
// Windows' OS resolver used by Playwright APIRequestContext may not do so.
const dns=require('node:dns')
const lookup=dns.lookup
const promiseLookup=dns.promises.lookup
const isLocal=hostname=>typeof hostname==='string'&&hostname.toLowerCase().endsWith('.localhost')
const address=options=>({address:(options===6||options?.family===6)?'::1':'127.0.0.1',family:(options===6||options?.family===6)?6:4})
dns.promises.lookup=async function(hostname,options){
 if(isLocal(hostname))return options?.all?[address(options)]:address(options)
 return promiseLookup.apply(this,arguments)
}
dns.lookup=function(hostname,options,callback){
 if(isLocal(hostname)){
  if(typeof options==='function'){callback=options;options={}}
  const result=address(options)
  process.nextTick(()=>options&&options.all?callback(null,[result]):callback(null,result.address,result.family))
  return
 }
 return lookup.apply(this,arguments)
}
