(function(){"use strict";importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");const a=loadPyodide();function c(t){self.postMessage({kind:"stdout",stdout:t})}function o(t){self.postMessage({kind:"stderr",stderr:t})}async function d(t){const{interruptBuffer:e,id:i}=t,{get:r}=await import("https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js");try{const s=await a,n=await r("webPythonDirectoryHandle");s.setInterruptBuffer(e),s.setStdout({batched:c}),s.setStderr({batched:o}),await s.mountNativeFS("/home/pyodide/",n),self.postMessage({kind:"finished",id:i})}catch{self.postMessage({kind:"error",error:error.message,id:i})}}async function p(t){const e=await a,{python:i,id:r,filename:s}=t;try{await e.loadPackage("micropip"),await e.runPythonAsync(`
        import micropip 
        import pathlib

        req_f = pathlib.Path("requirements.txt")

        reqs = []

        if req_f.is_file():
          reqs = [x.strip() for x in open("requirements.txt", "r").readlines() if x.strip()]
          await micropip.install(reqs, keep_going=True)`),await e.loadPackagesFromImports(i),await e.runPythonAsync(i,{filename:s}).catch(async()=>{o(await e.runPythonAsync("import sys; import traceback; '\\n'.join(traceback.format_exception(sys.last_exc))"))}),self.postMessage({kind:"finished",id:r})}catch(n){self.postMessage({kind:"error",error:n.message,id:r})}}self.onmessage=async t=>{const{data:e}=t;switch(e.kind){case"init":d(e);break;case"run":p(e);break}}})();
