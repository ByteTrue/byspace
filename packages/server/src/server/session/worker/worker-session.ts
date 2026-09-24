/**
 * RPC surface for the worker domain.
 *
 * Thin translation between wire messages and `WorkerService`. No domain rules
 * live here: if a decision (which template is legal, which transition is
 * allowed) appears in this file, it belongs in the service or the store.
 *
 * Failures are reported through the generic `rpc_error` message rather than
 * error fields on each response. The domain's errors are all refusals with a
 * human-readable reason, and threading an `error` field through every response
 * would duplicate what `rpc_error` already carries.
 */
import type pino from "pino";

import type { SessionInboundMessage, SessionOutboundMessage } from "@bytetrue/protocol/messages";

import type { WorkerService } from "../../worker/service.js";

export interface WorkerSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface WorkerSessionOptions {
  host: WorkerSessionHost;
  workerService: WorkerService;
  logger: pino.Logger;
}

export class WorkerSession {
  private readonly host: WorkerSessionHost;
  private readonly workerService: WorkerService;
  private readonly logger: pino.Logger;

  constructor(options: WorkerSessionOptions) {
    this.host = options.host;
    this.workerService = options.workerService;
    this.logger = options.logger;
  }

  private emitError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // Refusals are expected (a bad template, an illegal transition). Logging
    // them at error level would drown the log in user mistakes.
    const expected =
      error instanceof Error &&
      (error.name.endsWith("NotFoundError") ||
        error.name.endsWith("UnknownError") ||
        error.name === "IllegalWorkerTaskTransitionError" ||
        error.name === "WorkerTemplateIncompleteError");
    if (expected) {
      this.logger.debug({ requestType: request.type, err: message }, "Worker request refused");
    } else {
      this.logger.error({ requestType: request.type, err: error }, "Worker request failed");
    }
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "worker_request_failed",
      },
    });
  }

  async handleTemplateListRequest(
    request: Extract<SessionInboundMessage, { type: "worker.template.list.request" }>,
  ): Promise<void> {
    try {
      const templates = await this.workerService.listTemplates();
      this.host.emit({
        type: "worker.template.list.response",
        payload: { requestId: request.requestId, templates },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleWorkerListRequest(
    request: Extract<SessionInboundMessage, { type: "worker.worker.list.request" }>,
  ): Promise<void> {
    try {
      this.host.emit({
        type: "worker.worker.list.response",
        payload: { requestId: request.requestId, workers: this.workerService.listWorkers() },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleWorkerCreateRequest(
    request: Extract<SessionInboundMessage, { type: "worker.worker.create.request" }>,
  ): Promise<void> {
    try {
      const worker = await this.workerService.createWorker({
        name: request.name,
        templateId: request.templateId,
        ...(request.workspacePath !== undefined ? { workspacePath: request.workspacePath } : {}),
      });
      this.host.emit({
        type: "worker.worker.create.response",
        payload: { requestId: request.requestId, worker },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleWorkerGetRequest(
    request: Extract<SessionInboundMessage, { type: "worker.worker.get.request" }>,
  ): Promise<void> {
    try {
      const worker = this.workerService.getWorker(request.workerId);
      const tasks = this.workerService.listTasks(request.workerId);
      this.host.emit({
        type: "worker.worker.get.response",
        payload: { requestId: request.requestId, worker, tasks },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleTaskCreateRequest(
    request: Extract<SessionInboundMessage, { type: "worker.task.create.request" }>,
  ): Promise<void> {
    try {
      const task = this.workerService.createTask({
        workerId: request.workerId,
        title: request.title,
      });
      this.host.emit({
        type: "worker.task.create.response",
        payload: { requestId: request.requestId, task },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleTaskTransitionRequest(
    request: Extract<SessionInboundMessage, { type: "worker.task.transition.request" }>,
  ): Promise<void> {
    try {
      const task = this.workerService.transitionTask({
        taskId: request.taskId,
        toState: request.toState,
        action: request.action,
        actor: request.actor,
        ...(request.note !== undefined ? { note: request.note } : {}),
      });
      this.host.emit({
        type: "worker.task.transition.response",
        payload: { requestId: request.requestId, task },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleTaskRunRequest(
    request: Extract<SessionInboundMessage, { type: "worker.task.run.request" }>,
  ): Promise<void> {
    try {
      const task = await this.workerService.runTask(request.taskId);
      this.host.emit({
        type: "worker.task.run.response",
        payload: { requestId: request.requestId, task },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleTaskHistoryRequest(
    request: Extract<SessionInboundMessage, { type: "worker.task.history.request" }>,
  ): Promise<void> {
    try {
      const entries = this.workerService.taskHistory(request.taskId);
      this.host.emit({
        type: "worker.task.history.response",
        payload: { requestId: request.requestId, taskId: request.taskId, entries },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleTaskListRequest(
    request: Extract<SessionInboundMessage, { type: "worker.task.list.request" }>,
  ): Promise<void> {
    try {
      const tasks = this.workerService.listAllTasks(request.workerId);
      this.host.emit({
        type: "worker.task.list.response",
        payload: { requestId: request.requestId, tasks },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  // ----------------------------------------------------------------- groups

  async handleGroupListRequest(
    request: Extract<SessionInboundMessage, { type: "worker.group.list.request" }>,
  ): Promise<void> {
    try {
      const groups = this.workerService.listGroups().map((group) => this.toGroupSummary(group));
      this.host.emit({
        type: "worker.group.list.response",
        payload: { requestId: request.requestId, groups },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleGroupCreateRequest(
    request: Extract<SessionInboundMessage, { type: "worker.group.create.request" }>,
  ): Promise<void> {
    try {
      const group = this.workerService.createGroup({
        name: request.name,
        projectId: request.projectId,
        ...(request.workspaceId !== undefined ? { workspaceId: request.workspaceId } : {}),
        ...(request.coordinatorWorkerId !== undefined
          ? { coordinatorWorkerId: request.coordinatorWorkerId }
          : {}),
        ...(request.memberWorkerIds !== undefined
          ? { memberWorkerIds: request.memberWorkerIds }
          : {}),
      });
      this.host.emit({
        type: "worker.group.create.response",
        payload: { requestId: request.requestId, group: this.toGroupSummary(group) },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleGroupAddMemberRequest(
    request: Extract<SessionInboundMessage, { type: "worker.group.add_member.request" }>,
  ): Promise<void> {
    try {
      this.workerService.addGroupMember({
        groupId: request.groupId,
        workerId: request.workerId,
        role: request.role,
      });
      this.emitGroup(request, request.groupId);
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleGroupRemoveMemberRequest(
    request: Extract<SessionInboundMessage, { type: "worker.group.remove_member.request" }>,
  ): Promise<void> {
    try {
      this.workerService.removeGroupMember({
        groupId: request.groupId,
        workerId: request.workerId,
      });
      this.emitGroup(request, request.groupId);
    } catch (error) {
      this.emitError(request, error);
    }
  }

  /** Both member changes answer with the whole group, so a caller needs no refetch. */
  private emitGroup(
    request: Extract<
      SessionInboundMessage,
      { type: "worker.group.add_member.request" | "worker.group.remove_member.request" }
    >,
    groupId: string,
  ): void {
    const group = this.toGroupSummary(this.workerService.getGroup(groupId));
    this.host.emit(
      request.type === "worker.group.add_member.request"
        ? {
            type: "worker.group.add_member.response",
            payload: { requestId: request.requestId, group },
          }
        : {
            type: "worker.group.remove_member.response",
            payload: { requestId: request.requestId, group },
          },
    );
  }

  // ------------------------------------------------------------- messages

  async handleMessageSendRequest(
    request: Extract<SessionInboundMessage, { type: "worker.message.send.request" }>,
  ): Promise<void> {
    try {
      const { message, woke } = this.workerService.sendMessage({
        groupId: request.groupId,
        senderWorkerId: request.senderWorkerId,
        body: request.body,
        ...(request.intent !== undefined ? { intent: request.intent } : {}),
        ...(request.deliveryPolicy !== undefined ? { deliveryPolicy: request.deliveryPolicy } : {}),
        ...(request.replyToMessageId !== undefined
          ? { replyToMessageId: request.replyToMessageId }
          : {}),
        ...(request.audience !== undefined ? { audience: request.audience } : {}),
        ...(request.privateTo !== undefined ? { privateTo: request.privateTo } : {}),
      });

      this.host.emit({
        type: "worker.message.send.response",
        payload: { requestId: request.requestId, message, woke },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleMessageListRequest(
    request: Extract<SessionInboundMessage, { type: "worker.message.list.request" }>,
  ): Promise<void> {
    try {
      const messages = this.workerService.listMessages({
        groupId: request.groupId,
        ...(request.viewerWorkerId !== undefined ? { viewerWorkerId: request.viewerWorkerId } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      });
      this.host.emit({
        type: "worker.message.list.response",
        payload: { requestId: request.requestId, messages },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleInboxListRequest(
    request: Extract<SessionInboundMessage, { type: "worker.inbox.list.request" }>,
  ): Promise<void> {
    try {
      const entries = this.workerService.listInbox(request.workerId);
      this.host.emit({
        type: "worker.inbox.list.response",
        payload: { requestId: request.requestId, entries },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleMessageDeliveryRequest(
    request: Extract<SessionInboundMessage, { type: "worker.message.delivery.request" }>,
  ): Promise<void> {
    try {
      const marked = this.workerService.markMessageDelivery({
        messageId: request.messageId,
        workerId: request.workerId,
        state: request.state,
      });
      this.host.emit({
        type: "worker.message.delivery.response",
        payload: { requestId: request.requestId, marked },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  // ------------------------------------------------------------- activity

  async handleActivityRequest(
    request: Extract<SessionInboundMessage, { type: "worker.activity.request" }>,
  ): Promise<void> {
    try {
      const days = this.workerService.listTaskActivity(request.workerId);
      this.host.emit({
        type: "worker.activity.response",
        payload: { requestId: request.requestId, days },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  // ---------------------------------------------------------------- goals

  async handleGoalGetRequest(
    request: Extract<SessionInboundMessage, { type: "worker.goal.get.request" }>,
  ): Promise<void> {
    try {
      this.host.emit({
        type: "worker.goal.get.response",
        payload: {
          requestId: request.requestId,
          goal: this.workerService.getGoal(request.groupId),
        },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleGoalCreateRequest(
    request: Extract<SessionInboundMessage, { type: "worker.goal.create.request" }>,
  ): Promise<void> {
    try {
      const goal = this.workerService.createGoal({
        groupId: request.groupId,
        content: request.content,
        turnLimit: request.turnLimit,
      });
      this.host.emit({
        type: "worker.goal.create.response",
        payload: { requestId: request.requestId, goal },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  async handleGoalMutateRequest(
    request: Extract<SessionInboundMessage, { type: "worker.goal.mutate.request" }>,
  ): Promise<void> {
    try {
      const goal = this.workerService.mutateGoal({
        groupId: request.groupId,
        action: request.action,
        expectedGeneration: request.expectedGeneration,
        expectedRevision: request.expectedRevision,
        ...(request.content !== undefined ? { content: request.content } : {}),
        ...(request.turnLimit !== undefined ? { turnLimit: request.turnLimit } : {}),
        ...(request.pauseReason !== undefined ? { pauseReason: request.pauseReason } : {}),
        ...(request.resultMessageId !== undefined
          ? { resultMessageId: request.resultMessageId }
          : {}),
      });
      this.host.emit({
        type: "worker.goal.mutate.response",
        payload: { requestId: request.requestId, goal },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  /** Groups always carry their roster: a group without one says nothing useful. */
  private toGroupSummary(
    group: ReturnType<WorkerService["getGroup"]>,
  ): Extract<
    SessionOutboundMessage,
    { type: "worker.group.list.response" }
  >["payload"]["groups"][number] {
    return {
      ...group,
      members: this.workerService.listGroupMembers(group.id).map((member) => ({
        workerId: member.workerId,
        role: member.role,
        joinedAt: member.joinedAt,
      })),
    };
  }

  async handleGuardEvaluateRequest(
    request: Extract<SessionInboundMessage, { type: "worker.guard.evaluate.request" }>,
  ): Promise<void> {
    try {
      const verdict = this.workerService.evaluateGuard({
        command: request.command,
        ...(request.toolName !== undefined ? { toolName: request.toolName } : {}),
      });
      this.host.emit({
        type: "worker.guard.evaluate.response",
        payload: {
          requestId: request.requestId,
          decision: verdict.decision,
          maxSeverity: verdict.maxSeverity,
          findings: verdict.findings,
        },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }
}
