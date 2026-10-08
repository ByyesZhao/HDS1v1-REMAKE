import type { IncomingMessage, InputAcceptance } from '../types';
import { HdsiApp } from '../app';
import { InputBuffer } from './input';
import { Scheduler } from './scheduler';
import { milliseconds } from '../time';
import { setImmediate } from 'node:timers/promises';

export class SerialHost {
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private requested = false;
  private recover = false;
  private readonly input: InputBuffer;
  private readonly scheduler: Scheduler;
  constructor(private app: HdsiApp, private options: { timers?: boolean; onError?: (error: unknown) => void; onWarning?: (warning:string)=>void; yieldToEvents?:()=>Promise<void> } = {}) {
    this.input = new InputBuffer(app.dependencies.storage,app.dependencies.memoryIdle,app.dependencies.dialogue); this.scheduler = new Scheduler(app.dependencies.storage,app.dependencies.config);
  }
  private checkDialogue():void {const report=this.app.dependencies.dialogue?.checkConsistency();if(report?.blockingIssues.length)throw new Error(`dialogue 对话段索引不一致: ${report.blockingIssues.join('; ')}`);for(const warning of report?.historicalWarnings??[])this.options.onWarning?.(warning);}
  async start(): Promise<void> {this.checkDialogue();this.recover=true;await this.wake();}
  async acceptInput(message: IncomingMessage): Promise<InputAcceptance> {
    const accepted = await this.input.acceptInput(message);
    void this.wake();
    return accepted;
  }
  wake(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.requested = true;
    if (this.active) return this.active.then(() => {
      // A wake can arrive after the pump's last scan but before its finalizer runs.
      if (this.requested && !this.stopped) return this.wake();
    });
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.active = this.pump().catch(error => this.options.onError?.(error)).finally(async () => {
      this.active = null;
      await this.armTimer();
    });
    return this.active;
  }
  private async pump(): Promise<void> {
    const d = this.app.dependencies;
    while (!this.stopped) {
      this.requested = false;
      this.input.closeReady(d.clock.now());
      d.storage.transaction(()=>d.dialogue?.closeDue(d.clock.now()));
      if (d.storage.runtime().paused || this.stopped) break;
      if (d.storage.unfinishedTurn()) {
        if (!this.recover) break;
        this.recover = false; await this.app.resumeUnfinishedTurn();continue;
      }
      this.recover = false;
      const ready = await this.scheduler.collectReady(d.clock.now());
      if (ready) {await this.app.runTurn(ready);if(ready.environmentStepId)await (this.options.yieldToEvents??setImmediate)();continue;}
      if(this.stopped||d.storage.runtime().paused||d.storage.runtime().openBatch)break;
      const cleaned=d.memoryCleanup?.applyOne(d.clock.now())??'none';
      if(cleaned==='applied'){await (this.options.yieldToEvents??setImmediate)();continue;}
      const applied=d.maintenance?.applyOneReady(d.clock.now())??'none';
      if(applied!=='none'){await (this.options.yieldToEvents??setImmediate)();continue;}
      d.maintenance?.startOne(d.clock.now());
      break;
    }
  }
  private async armTimer(): Promise<void> {
    if (this.stopped || this.active || this.options.timers === false) return;
    const d = this.app.dependencies;
    const deadline = await this.nextDeadline();
    if (!deadline || this.stopped || this.active) return;
    // One timer only; the upper bound is Node's supported timer range, not a story polling interval.
    const wait = Math.min(2_147_483_647, Math.max(0, milliseconds(deadline) - milliseconds(d.clock.now())));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.wake(); }, wait);
  }
  private async nextDeadline():Promise<string|null>{
    const d=this.app.dependencies,front=await this.scheduler.nextDeadline(d.clock.now());
    const back=d.storage.runtime().paused||d.storage.runtime().openBatch||d.storage.unfinishedTurn()?null:d.maintenance?.nextDeadline(d.clock.now());
    const cleanup=d.memoryCleanup?.nextDeadline(d.clock.now());
    return [front,back,cleanup,d.dialogue?.nextDeadline(d.clock.now())].filter((at):at is string=>!!at).sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
  }
  async pause(): Promise<void> {
    const d = this.app.dependencies;
    d.storage.set('runtime', { ...d.storage.runtime(), paused: true });
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.armTimer();
  }
  async resume(): Promise<void> {
    const d = this.app.dependencies;
    this.checkDialogue();
    d.storage.set('runtime', { ...d.storage.runtime(), paused: false, lastError: null, lastFailure:null });
    this.recover = true;
    await this.wake();
  }
  async status(): Promise<string> {
    const d = this.app.dependencies, t = d.storage.unfinishedTurn();
    const stage = !t ? '空闲' : t.outputComplete ? '后处理' : t.frozenResult ? '发送' : '生成';
    const next = await this.nextDeadline();
    const display = next ? new Intl.DateTimeFormat('zh-CN', { timeZone: d.config.timezone, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(next)) : '无';
    const maintenance=d.maintenance?.status();
    const web=d.web?.status();
    const capacity=d.memoryCapacity?.counts(d.clock.now()),idle=d.memoryIdle?.eligibility(d.clock.now()),cleanup=d.memoryCleanup?.status();
    return `状态：${d.storage.runtime().paused ? '暂停' : '运行'}；阶段：${stage}；下次调度：${display}`+(d.storage.runtime().lastFailure?`；前台失败：${d.storage.runtime().lastFailure!.kind}／${d.storage.runtime().lastFailure!.task??'无模型任务'}／${d.storage.runtime().lastFailure!.safeSummary}`:'')+(maintenance?`；维护：待办${maintenance.pending}／就绪${maintenance.ready}／在途${maintenance.inFlight?1:0}／重试${maintenance.retries}／后台请求${maintenance.backendRequests}；后台错误：${maintenance.lastError??'无'}；检索：查询${maintenance.retrieval.queries}／缓存${maintenance.retrieval.cacheHits}／远程${maintenance.retrieval.remoteRequests}／超时${maintenance.retrieval.timeouts}／失败${maintenance.retrieval.failures}／词法降级${maintenance.retrieval.lexicalFallbacks}／主动跳过${maintenance.retrieval.semanticSkipped??0}`:'')+(capacity?`；短期活跃${capacity.shortActive}；长期占用${capacity.longOccupied}／预备${capacity.longPreview}／可见${capacity.longVisible}／归档${capacity.longArchive}；容量目标${JSON.stringify(d.memoryCapacity!.config)}；超量${capacity.shortOverflow}/${capacity.longOverflow}/${capacity.archiveOverflow}；保护${capacity.protectedLong}；清理阻挡${cleanup?.oldestBlock??'无'}`:'')+(idle?`；空闲资格${idle.reason}／截止${idle.readyAt??'无'}；增量待办${d.memoryStore?.dirtyOwners().length??0}`:'')+(web?`；网页（页面额度，非费用）：${JSON.stringify(web)}`:'');
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const background=this.app.dependencies.maintenance?.stop();
    await Promise.all([this.active,background]);
  }
}
