import {lookup as systemLookup} from 'node:dns/promises'

// Legacy module name retained for import compatibility. GitHub downloads use
// the same system DNS / trusted local Fake-IP proxy as all other requests.
export function createGithubLookup({lookup=systemLookup} = {}) {
  return async function(host, options = {}) {
    if(!['api.github.com','raw.githubusercontent.com'].includes(host))throw Error('GitHub 下载域名无效')
    return lookup(host,{...options,all:true,verbatim:true})
  }
}
