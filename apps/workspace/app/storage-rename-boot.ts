export const RENAMED_STORAGE_KEYS: Readonly<Record<string, string>> = {
  'grid-layout': 'layout',
  'grid:chunk-reload-ts': 'chunk-reload-ts',
  'grid.sidebar.collapsed': 'sidebar.collapsed',
  'grid.sidebar.width': 'sidebar.width',
  'grid.project.recent': 'project.recent',
  'grid.project.last-section': 'project.last-section',
  'grid.viewerActions.auto': 'viewerActions.auto',
  'grid.files.brief.collapsed': 'files.brief.collapsed',
  'grid.files.view': 'files.view',
  'grid.filePeek.width': 'filePeek.width',
  'grid.search.recent': 'search.recent',
  'grid.keyboard-shortcuts.enabled': 'keyboard-shortcuts.enabled',
  'grid.return-trail': 'return-trail',
  'piloti-chat-effort': 'chat-effort',
  'piloti.usage-notice.dismissed': 'usage-notice.dismissed',
  'piloti.review.toolsIntroSeen': 'review.toolsIntroSeen',
  'piloti.push-offer.shown': 'push-offer.shown',
  'piloti.push-prompt.dismissed': 'push-prompt.dismissed',
}

export const RENAMED_STORAGE_PREFIXES: Readonly<Record<string, string>> = {
  'piloti.mailImport.file.': 'mailImport.file.',
}

export const STORAGE_RENAME_BOOT_SCRIPT =
  '(function(){var k={"grid-layout":"layout","grid:chunk-reload-ts":"chunk-reload-ts","grid.sidebar.collapsed":"sidebar.collapsed","grid.sidebar.width":"sidebar.width","grid.project.recent":"project.recent","grid.project.last-section":"project.last-section","grid.viewerActions.auto":"viewerActions.auto","grid.files.brief.collapsed":"files.brief.collapsed","grid.files.view":"files.view","grid.filePeek.width":"filePeek.width","grid.search.recent":"search.recent","grid.keyboard-shortcuts.enabled":"keyboard-shortcuts.enabled","grid.return-trail":"return-trail","piloti-chat-effort":"chat-effort","piloti.usage-notice.dismissed":"usage-notice.dismissed","piloti.review.toolsIntroSeen":"review.toolsIntroSeen","piloti.push-offer.shown":"push-offer.shown","piloti.push-prompt.dismissed":"push-prompt.dismissed"};var p={"piloti.mailImport.file.":"mailImport.file."};function move(s,from,to){var v=s.getItem(from);if(v===null)return;if(s.getItem(to)===null)s.setItem(to,v);s.removeItem(from)}function run(s){var o,i,n,names=[];for(o in k)if(Object.prototype.hasOwnProperty.call(k,o))move(s,o,k[o]);for(i=0;i<s.length;i++)names.push(s.key(i));for(i=0;i<names.length;i++)for(o in p)if(Object.prototype.hasOwnProperty.call(p,o)&&names[i]&&names[i].indexOf(o)===0){n=p[o]+names[i].slice(o.length);move(s,names[i],n)}}try{run(window.localStorage)}catch(e){}try{run(window.sessionStorage)}catch(e){}})()'
