import r2pipe, json, re, collections
import sys
r=r2pipe.open(sys.argv[1] if len(sys.argv) > 1 else 'BM95.EXE', flags=['-2'])
r.cmd('e scr.color=0; e asm.bytes=false; aaa')
xs=json.loads(r.cmd('axtj @ 0x412135'))
uses=collections.defaultdict(set)
for x in xs:
    a=x['from']
    dis=json.loads(r.cmd(f'pdj -6 @ {a}'))
    imm=None
    for ins in reversed(dis):
        m=re.match(r'mov eax, (0x[0-9a-f]+|\d+)$', ins.get('disasm',''))
        if m: imm=int(m.group(1),0); break
    fn=x.get('fcn_name') or hex(a)
    uses[fn].add(imm)
inv=collections.defaultdict(set)
for fn,ids in uses.items():
    for i in ids: inv[i].add(fn)
for i in sorted(k for k in inv if k is not None): print(i, sorted(inv[i]))
print('unknown', sorted(inv.get(None,[])))
