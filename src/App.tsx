import { lazy, Suspense, useEffect, useState } from 'react'
import Landing from './components/experience/Landing'
import Intro from './components/experience/Intro'
import { Brand, Spinner } from './components/experience/shared'
import { INTRO_KEY } from './lib/workspace'
const Workspace=lazy(()=>import('./components/experience/Workspace'))
function routeFromHash(){const hash=window.location.hash.slice(1);return hash.startsWith('/')?hash:'/'}
export default function App(){
 const [route,setRoute]=useState(routeFromHash)
 useEffect(()=>{const change=()=>{if(!window.location.hash.slice(1).startsWith('/'))return;setRoute(routeFromHash());window.scrollTo({top:0,behavior:'instant'})};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[])
 const navigate=(next:string)=>{window.location.hash=next}
 const start=(template?:string)=>{if(template)sessionStorage.setItem('circuit.start-template',template);navigate(localStorage.getItem(INTRO_KEY)==='true'?'/app':'/welcome')}
 const complete=()=>{localStorage.setItem(INTRO_KEY,'true');navigate('/app')}
 useEffect(()=>{document.title=route.startsWith('/app')?'Circuit — Your workspace':'Circuit — Your rules. Always in motion.'},[route])
 return <><a className="skip-link" href="#main-content">Skip to content</a>{route.startsWith('/app')?<Suspense fallback={<div className="workspace-loading"><Brand/><Spinner label="Opening your workspace"/></div>}><Workspace route={route} navigate={navigate}/></Suspense>:route==='/welcome'?<Intro onComplete={complete} onBack={()=>navigate('/')}/>:<Landing onStart={start}/>}</>
}
