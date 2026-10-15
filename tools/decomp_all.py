import angr, sys, logging, os, signal
logging.disable(logging.CRITICAL)
p=angr.Project(sys.argv[1] if len(sys.argv) > 1 else 'BM95.EXE', auto_load_libs=False)
cfg=p.analyses.CFGFast(normalize=True, data_references=True)
out=sys.argv[2] if len(sys.argv) > 2 else 'decomp'; os.makedirs(out, exist_ok=True)
funcs=sorted(a for a,f in cfg.kb.functions.items() if 0x401000<=a<0x458000)
print(len(funcs), flush=True)
class TO(Exception): pass
def h(s,f): raise TO()
signal.signal(signal.SIGALRM, h)
for a in funcs:
    fn=f'{out}/{a:08x}.c'
    if os.path.exists(fn): continue
    f=cfg.kb.functions[a]
    signal.alarm(60)
    try:
        d=p.analyses.Decompiler(f, cfg=cfg.model)
        txt=d.codegen.text if d.codegen else '// no codegen'
    except TO: txt='// timeout'
    except Exception as e: txt='// ERR '+str(e)[:200]
    signal.alarm(0)
    open(fn,'w').write(f'// {a:#x} {f.name}\n'+txt+'\n')
print('done', flush=True)
