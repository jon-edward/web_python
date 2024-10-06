import{showDirectoryPicker as L}from"https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js";(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))d(r);new MutationObserver(r=>{for(const o of r)if(o.type==="childList")for(const s of o.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&d(s)}).observe(document,{childList:!0,subtree:!0});function n(r){const o={};return r.integrity&&(o.integrity=r.integrity),r.referrerPolicy&&(o.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?o.credentials="include":r.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function d(r){if(r.ep)return;r.ep=!0;const o=n(r);fetch(r.href,o)}})();const C="modulepreload",S=function(e){return"/"+e},w={},F=function(t,n,d){let r=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const s=document.querySelector("meta[property=csp-nonce]"),i=s?.nonce||s?.getAttribute("nonce");r=Promise.allSettled(n.map(c=>{if(c=S(c),c in w)return;w[c]=!0;const m=c.endsWith(".css"),P=m?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${P}`))return;const a=document.createElement("link");if(a.rel=m?"stylesheet":C,m||(a.as="script"),a.crossOrigin="",a.href=c,i&&a.setAttribute("nonce",i),document.head.appendChild(a),m)return new Promise((B,v)=>{a.addEventListener("load",B),a.addEventListener("error",()=>v(new Error(`Unable to preload CSS for ${c}`)))})}))}function o(s){const i=new Event("vite:preloadError",{cancelable:!0});if(i.payload=s,window.dispatchEvent(i),!i.defaultPrevented)throw s}return r.then(s=>{for(const i of s||[])i.status==="rejected"&&o(i.reason);return t().catch(o)})};class M{stderrFunc;stdoutFunc;callbacks;worker;id;interruptBuffer;constructor(t,n){this.callbacks={},this.worker=new Worker(new URL("/assets/_worker-D-W_-x8z.js",import.meta.url),{type:"classic"}),this.worker.onmessage=d=>this.onMessage(d.data),this.id=0,this.stdoutFunc=t,this.stderrFunc=n,this.interruptBuffer=new Uint8Array(new SharedArrayBuffer(1))}invokeCallback(t){const n=this.callbacks[t];delete this.callbacks[t],n()}onFinished(t){const{id:n}=t;this.invokeCallback(n)}onStderr(t){const{stderr:n}=t;this.stderrFunc(n)}onStdout(t){const{stdout:n}=t;this.stdoutFunc(n)}onError(t){const{error:n,id:d}=t;this.stderrFunc(`Error at worker: 
${n}`),this.invokeCallback(d)}onMessage(t){switch(t.kind){case"finished":this.onFinished(t);break;case"stderr":this.onStderr(t);break;case"stdout":this.onStdout(t);break;case"error":this.onError(t);break}}async sendMessage(t){return this.id=(this.id+1)%Number.MAX_SAFE_INTEGER,new Promise(n=>{this.callbacks[this.id]=n,this.worker.postMessage({id:this.id,...t})})}async runPython(t,n){this.interruptBuffer[0]=0,await this.sendMessage({kind:"run",python:t,filename:n})}async init(){await this.sendMessage({kind:"init",interruptBuffer:this.interruptBuffer})}stop(){console.log(this.interruptBuffer),this.interruptBuffer[0]=2}}const{set:x}=await F(async()=>{const{set:e}=await import("https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js");return{set:e}},[]),E=document.getElementById("project-directory"),D=document.getElementById("project-directory-name"),b=document.getElementById("entry-point"),h=document.getElementById("entry-point-name"),k=document.getElementById("run-button"),g=document.getElementById("stop-button"),y=document.getElementById("stdout");let f,p,u=!1;function j(){return u}function N(){return u||f===void 0}function O(){return u||f===void 0||p===void 0}function l(){E.disabled=j(),k.disabled=O(),b.disabled=N(),g.disabled=!u}function I(){p&&(p=void 0),h.textContent="No file selected"}function _(e){f=e;const t=document.createElement("span");t.textContent=e.name,t.classList.add("success"),D.innerHTML=t.outerHTML}async function A(e,t){p=e;const n=document.createElement("span");n.textContent=t.join(" / "),n.classList.add("success"),h.innerHTML=n.outerHTML}function H(e){p=void 0;const t=document.createElement("span");t.textContent=e,t.classList.add("error"),h.innerHTML=t.outerHTML}l();class T extends Error{}E.onclick=async()=>{let e;try{if(e=await L({mode:"readwrite"}),!e)return;if(!("requestPermission"in e)||await e.requestPermission({mode:"readwrite"})!=="granted")throw new T("This browser does not support writeable file system directory handles.")}catch(t){if(!(t instanceof DOMException))throw t}e&&(f&&await f.isSameEntry(e)||(await x("webPythonDirectoryHandle",e),_(e),I(),l()))};b.onclick=async()=>{const e={types:[{description:"Entry point script",accept:{"text/x-python":[".py"]}}],excludeAcceptAllOption:!0,multiple:!1},[t]=await window.showOpenFilePicker(e);if(!f)throw new Error("Project handle is not defined.");const n=await f.resolve(t);if(!n){H("Entry point provided not in project directory."),l();return}A(t,n),l()};function W(e){const t=document.createElement("span");t.textContent=`${e}
`,y.appendChild(t)}function q(e){const t=document.createElement("span");t.classList.add("error"),t.textContent=e,y.appendChild(t)}k.onclick=async()=>{u=!0,l(),y.textContent="";try{const e=new M(W,q);await e.init(),g.onclick=async()=>{e.stderrFunc=console.log,e.stdoutFunc=console.error,u=!1,l(),e.stop()};const t=await(await p.getFile()).text();await e.runPython(t,p.name)}finally{u=!1,l()}};
