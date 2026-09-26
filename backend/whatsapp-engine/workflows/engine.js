/**
 * whatsapp-engine/workflows/engine.js — Visual chatbot flow builder
 * ═════════════════════════════════════════════════════════════════
 *
 * Defines decision trees for automated customer interactions.
 * Flows are JSON-based and editable via the API.
 *
 * Flow structure:
 * {
 *   "id": "order_flow",
 *   "name": "Order Workflow",
 *   "start": "greeting",
 *   "nodes": {
 *     "greeting": { "type": "message", "text": "welcome_template", "next": "ask_type" },
 *     "ask_type": { "type": "question", "text": "What would you like?",
 *       "options": [
 *         { "text": "New Order", "next": "collect_order" },
 *         { "text": "Track Order", "next": "track_order" },
 *         { "text": "Customer Service", "next": "agent_transfer" }
 *       ]}
 *   }
 * }
 *
 * Node types:
 *   - message: Send text, auto-advance to next
 *   - question: Send text with options, wait for reply
 *   - condition: Branch based on customer response
 *   - api_call: Call ERP endpoint, branch on result
 *   - delay: Wait N seconds
 *   - transfer: Transfer to human agent
 *   - end: Stop flow
 */
'use strict';

const { logger } = require('../../logger');
const store = require('../store');
const { TemplateManager } = require('../templates');
const { AIChatbot } = require('../ai/chatbot');

class WorkflowEngine {
    constructor() {
        this._flows = new Map();
        this._activeSessions = new Map(); // jid → { flowId, currentNode, history }
    }

    /** Load a flow definition and register it */
    async loadFlow(flowId) {
        try {
            const raw = await store.getFlow(flowId);
            if (!raw) {
                logger.warn(`[Workflow] Flow not found: ${flowId}`);
                return null;
            }
            const flow = JSON.parse(raw.definition);
            this._flows.set(flowId, flow);
            return flow;
        } catch (e) {
            logger.error(`[Workflow] loadFlow failed: ${e.message}`);
            return null;
        }
    }

    /** Start a flow for a customer */
    async startFlow(jid, flowId) {
        const flow = this._flows.get(flowId) || await this.loadFlow(flowId);
        if (!flow) {return null;}

        this._activeSessions.set(jid, {
            flowId,
            currentNode: flow.start,
            history: [{ role: 'system', text: `Flow started: ${flow.name}` }],
            startedAt: Date.now(),
        });

        const startNode = flow.nodes[flow.start];
        return this._executeNode(jid, startNode, flow);
    }

    /** Handle a customer reply within an active flow */
    async handleReply(jid, message) {
        const session = this._activeSessions.get(jid);
        if (!session) {return null;}

        const flow = this._flows.get(session.flowId);
        if (!flow) {return null;}

        session.history.push({ role: 'user', text: message });
        const currentNode = flow.nodes[session.currentNode];

        // Check conditions
        if (currentNode.type === 'condition') {
            return this._evaluateCondition(jid, message, currentNode, flow);
        }

        // Question node — match against options
        if (currentNode.type === 'question') {
            return this._matchOption(jid, message, currentNode, flow);
        }

        // Auto-advance if it was a message node
        if (currentNode.type === 'message') {
            session.currentNode = currentNode.next;
            const nextNode = flow.nodes[currentNode.next];
            if (nextNode) {return this._executeNode(jid, nextNode, flow);}
        }

        return null;
    }

    async _executeNode(jid, node, flow) {
        const session = this._activeSessions.get(jid);
        if (!session) {return null;}

        switch (node.type) {
            case 'message':
                session.currentNode = node.next;
                return { type: 'message', text: node.text, flowId: flow.id };

            case 'question':
                return { type: 'question', text: node.text, options: node.options, flowId: flow.id };

            case 'api_call':
                return { type: 'api_call', endpoint: node.endpoint, params: node.params };

            case 'delay':
                return { type: 'delay', seconds: node.seconds };

            case 'transfer':
                return { type: 'transfer', agentId: node.agentId };

            case 'end':
                this._activeSessions.delete(jid);
                return { type: 'end', text: node.text || 'Shukran! 👋' };

            default:
                return null;
        }
    }

    async _matchOption(jid, message, node, flow) {
        const session = this._activeSessions.get(jid);
        const normalized = message.toLowerCase().trim();

        for (const option of node.options) {
            if (normalized.includes(option.text.toLowerCase().slice(0, 5)) ||
                option.shortcut === normalized) {
                session.currentNode = option.next;
                const nextNode = flow.nodes[option.next];
                if (nextNode) {
                    session.history.push({ role: 'system', text: `Selected: ${option.text}` });
                    return this._executeNode(jid, nextNode, flow);
                }
            }
        }

        return { type: 'question', text: 'لم أفهم اختيارك. اختر من القائمة:', options: node.options };
    }

    async _evaluateCondition(jid, message, node, flow) {
        // Simple keyword matching for conditions
        const session = this._activeSessions.get(jid);
        const history = session.history.map(h => h.text).join(' ').toLowerCase();

        if (node.match && node.match.some(kw => history.includes(kw))) {
            session.currentNode = node.true_next;
        } else {
            session.currentNode = node.false_next || node.false_default;
        }

        const nextNode = flow.nodes[session.currentNode];
        return nextNode ? this._executeNode(jid, nextNode, flow) : null;
    }

    /** Get active sessions count */
    get activeCount() { return this._activeSessions.size; }

    /** End a flow for a customer */
    endFlow(jid) { this._activeSessions.delete(jid); }
}

module.exports = { WorkflowEngine };