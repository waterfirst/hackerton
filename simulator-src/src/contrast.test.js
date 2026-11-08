import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('./style.css',import.meta.url),'utf8');
const crack=readFileSync(new URL('./crack.css',import.meta.url),'utf8');
const declaration=(source,selector,property)=>{
  const block=source.split(`${selector}{`)[1]?.split('}')[0];
  assert.ok(block,`${selector} rule exists`);
  return block.split(';').map(v=>v.split(':')).find(([key])=>key===property)?.[1];
};
const resolve=value=>value.startsWith('var(')?declaration(css,':root',value.slice(4,-1)):value;
const luminance=hex=>{
  const normalized=hex.length===4?'#'+[...hex.slice(1)].map(v=>v+v).join(''):hex;
  assert.match(normalized,/^#[a-f\d]{6}$/i);
  const linear=[1,3,5].map(i=>parseInt(normalized.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return linear.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
};
const contrast=(foreground,background)=>{
  const values=[luminance(resolve(foreground)),luminance(resolve(background))].sort((a,b)=>b-a);
  return (values[0]+.05)/(values[1]+.05);
};
test('WCAG contrast calculation matches black/white and the reported regression',()=>{
  assert.equal(contrast('#000','#fff'),21);
  assert.ok(contrast('#bacab5','#eff3eb')<1.6);
});
for(const [source,selector] of [[css,'th'],[crack,'.crack-data th'],[crack,'.crack-probe-comparison th']])test(`${selector} explicitly pairs dark text and light background with AAA contrast`,()=>{
  const fg=declaration(source,selector,'color'),bg=declaration(source,selector,'background');
  assert.ok(fg&&bg,'Header must not inherit the surrounding dark-panel text color');
  assert.ok(contrast(fg,bg)>=7,`${selector} small text must meet 7:1`);
  assert.ok(+declaration(source,selector,'font-weight')>=600);
});
test('light-theme secondary text, controls, charts, links and pending marker meet AA',()=>{
  const cases=[
    [declaration(css,':root','--muted'),'#f4f6ef'],
    [declaration(css,':root','--teal'),'#eef2e9'],
    [declaration(css,'.control-range','color'),'#f4f6ef'],
    [declaration(css,'.stat p','color'),'#fffef8'],
    [declaration(css,'.chart text','fill'),'#fffef8'],
    [declaration(css,'.pending-icon','color'),'#fffef8'],
  ];
  for(const [fg,bg] of cases)assert.ok(contrast(fg,bg)>=4.5,`${fg} on ${bg}: ${contrast(fg,bg).toFixed(2)}`);
});
