(function () {
    'use strict';

    const LEGACY_KEYS = {
        projects: 'procurement_tracker_data_v2',
        categories: 'procurement_categories_v2',
        methods: 'procurement_methods_v2'
    };
    const state = {
        revision: 0,
        etag: null,
        categories: [],
        methods: [],
        columns: [],
        actor: null,
        permissions: { canEdit: false, canAdmin: false },
        editingVersion: null,
        editRequestId: null,
        loading: false,
        online: false,
        lastErrorMessage: '',
        pollTimer: null,
        latestConflict: null
    };

    const original = {
        openAddModal: window.openAddModal,
        editProject: window.editProject,
        closeAddModal: window.closeAddModal,
        renderTable: window.renderTable
    };

    function safeJsonParse(value, fallback) {
        if (!value) return fallback;
        try {
            const parsed = JSON.parse(value);
            return parsed ?? fallback;
        } catch {
            return fallback;
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[char]);
    }

    function formatTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
    }

    function setSyncStatus(kind, text) {
        const badge = document.getElementById('shared-sync-status');
        if (!badge) return;
        const colors = {
            online: 'bg-emerald-100 text-emerald-700 border-emerald-200',
            syncing: 'bg-blue-100 text-blue-700 border-blue-200',
            saving: 'bg-amber-100 text-amber-700 border-amber-200',
            offline: 'bg-red-100 text-red-700 border-red-200'
        };
        const icons = { online: 'fa-cloud-arrow-up', syncing: 'fa-rotate fa-spin', saving: 'fa-floppy-disk', offline: 'fa-cloud-xmark' };
        badge.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${colors[kind] || colors.offline}`;
        badge.innerHTML = `<i class="fa-solid ${icons[kind] || icons.offline}"></i><span>${escapeHtml(text)}</span>`;
        badge.title = state.actor ? `当前用户：${state.actor.email}` : text;
    }

    function createUi() {
        const actions = document.querySelector('button[onclick="openCatMethodModal()"]')?.parentElement;
        if (actions && !document.getElementById('shared-sync-status')) {
            const status = document.createElement('span');
            status.id = 'shared-sync-status';
            actions.parentElement.insertBefore(status, actions);

            const logsButton = document.createElement('button');
            logsButton.id = 'btn-audit-logs';
            logsButton.type = 'button';
            logsButton.className = 'hidden bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow items-center transition';
            logsButton.innerHTML = '<i class="fa-solid fa-clock-rotate-left me-1.5 text-sm"></i>操作日志';
            logsButton.addEventListener('click', openAuditLogModal);
            actions.insertBefore(logsButton, actions.firstChild);
        }

        if (!document.getElementById('legacy-import-banner')) {
            const banner = document.createElement('div');
            banner.id = 'legacy-import-banner';
            banner.className = 'hidden max-w-[1700px] w-[98%] mx-auto mt-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs text-amber-900 shadow-sm';
            banner.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div><i class="fa-solid fa-database me-2"></i><strong>检测到本机旧数据</strong>：公共数据库目前为空，请确认本机数据是正式版本后再导入。</div>
                    <div class="flex gap-2">
                        <button type="button" id="btn-export-legacy" class="px-3 py-1.5 rounded-lg border border-amber-400 bg-white hover:bg-amber-100">先导出 JSON 备份</button>
                        <button type="button" id="btn-import-legacy" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold">导入公共数据库</button>
                    </div>
                </div>`;
            document.querySelector('header')?.insertAdjacentElement('afterend', banner);
            banner.querySelector('#btn-export-legacy').addEventListener('click', exportLegacyBackup);
            banner.querySelector('#btn-import-legacy').addEventListener('click', importLegacyData);
        }

        if (!document.getElementById('modal-shared-conflict')) {
            const modal = document.createElement('div');
            modal.id = 'modal-shared-conflict';
            modal.className = 'fixed inset-0 bg-black/60 hidden items-center justify-center z-[70] p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center border-b pb-3">
                        <h3 class="text-base font-bold text-red-700"><i class="fa-solid fa-code-compare me-2"></i>检测到多人编辑冲突</h3>
                        <button type="button" data-conflict-action="close" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                    </div>
                    <p class="text-sm text-slate-600">这条记录在您编辑期间已被其他同事修改。系统没有覆盖任何人的数据，请比较后选择下一步。</p>
                    <div id="conflict-diff" class="overflow-x-auto"></div>
                    <div class="flex flex-wrap justify-end gap-2 pt-3 border-t">
                        <button type="button" data-conflict-action="close" class="px-4 py-2 border rounded-lg text-xs">继续查看当前表单</button>
                        <button type="button" data-conflict-action="server" class="px-4 py-2 bg-slate-700 text-white rounded-lg text-xs">加载服务器最新版</button>
                        <button type="button" data-conflict-action="mine" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs">基于最新版保留我的内容</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('[data-conflict-action]').forEach(button => {
                button.addEventListener('click', () => handleConflictAction(button.dataset.conflictAction));
            });
        }

        if (!document.getElementById('modal-audit-logs')) {
            const modal = document.createElement('div');
            modal.id = 'modal-audit-logs';
            modal.className = 'fixed inset-0 bg-black/60 hidden items-center justify-center z-[65] p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-xl shadow-2xl max-w-6xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
                    <div class="flex justify-between items-center border-b pb-3 shrink-0">
                        <div>
                            <h3 class="text-base font-bold text-gray-800"><i class="fa-solid fa-clock-rotate-left text-slate-600 me-2"></i>操作日志</h3>
                            <p class="text-[11px] text-gray-500 mt-1">日志只读，记录操作者、数据版本以及修改前后内容。</p>
                        </div>
                        <button type="button" id="btn-close-audit" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                    </div>
                    <div id="audit-log-content" class="overflow-auto flex-grow text-xs"></div>
                    <div class="flex justify-between items-center pt-3 border-t shrink-0">
                        <button type="button" id="btn-export-public-json" class="px-3 py-1.5 border rounded-lg text-xs hover:bg-gray-50"><i class="fa-solid fa-download me-1"></i>导出当前 JSON 备份</button>
                        <button type="button" id="btn-close-audit-footer" class="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs">关闭</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#btn-close-audit').addEventListener('click', closeAuditLogModal);
            modal.querySelector('#btn-close-audit-footer').addEventListener('click', closeAuditLogModal);
            modal.querySelector('#btn-export-public-json').addEventListener('click', exportPublicBackup);
        }

        if (!document.getElementById('modal-column-settings')) {
            const modal = document.createElement('div');
            modal.id = 'modal-column-settings';
            modal.className = 'fixed inset-0 bg-black/60 hidden items-center justify-center z-[65] p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
                    <div class="flex justify-between items-start border-b pb-3 shrink-0">
                        <div>
                            <h3 class="text-base font-bold text-gray-800"><i class="fa-solid fa-table-columns text-violet-600 me-2"></i>表格列设置</h3>
                            <p class="text-[11px] text-gray-500 mt-1">可以修改所有业务列的名称，也可以新增自定义列；改名不会改变或丢失已有数据。</p>
                        </div>
                        <button type="button" data-close-column-modal class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                    </div>
                    <div class="bg-violet-50 border border-violet-200 rounded-xl p-3 shrink-0">
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input id="input-new-column" type="text" maxlength="60" placeholder="输入新列名称，如：计划完成时间"
                                class="flex-grow border border-gray-300 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                            <button id="btn-add-column" type="button" class="bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition shrink-0">
                                <i class="fa-solid fa-plus me-1"></i>新增一列
                            </button>
                        </div>
                        <p class="text-[11px] text-violet-700 mt-2">最多新增 30 列。新列会自动加入项目表单、搜索、Excel 导出和 WPS 复制。</p>
                    </div>
                    <div class="overflow-y-auto flex-grow">
                        <div id="column-settings-list" class="space-y-2"></div>
                    </div>
                    <div class="flex justify-end pt-3 border-t shrink-0">
                        <button type="button" data-close-column-modal class="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs">完成并关闭</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelectorAll('[data-close-column-modal]').forEach(button => button.addEventListener('click', closeColumnModal));
            modal.querySelector('#btn-add-column').addEventListener('click', addColumn);
            modal.querySelector('#input-new-column').addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    addColumn();
                }
            });
        }
        setSyncStatus('syncing', '正在连接公共数据');
    }

    function option(select, value, label = value) {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = label;
        select.appendChild(item);
    }

    function refillSelect(select, values, emptyLabel, selectedValue) {
        if (!select) return;
        select.replaceChildren();
        if (emptyLabel !== null) option(select, '', emptyLabel);
        values.forEach(value => option(select, value));
        if ([...select.options].some(item => item.value === selectedValue)) select.value = selectedValue;
    }

    function activeCategoryNames() {
        return state.categories.filter(item => Number(item.is_active) === 1).map(item => item.name);
    }

    function activeMethodNames() {
        return state.methods.filter(item => Number(item.is_active) === 1).map(item => item.name);
    }

    window.initFilterDropdowns = function () {
        const filterCategory = document.getElementById('filter-category');
        const filterDept = document.getElementById('filter-dept');
        const filterStatus = document.getElementById('filter-status');
        const filterHandler = document.getElementById('filter-handler');
        const formCategory = document.getElementById('form-category');
        const formMethod = document.getElementById('form-method');
        const selected = {
            category: filterCategory?.value || '',
            dept: filterDept?.value || '',
            status: filterStatus?.value || '',
            handler: filterHandler?.value || '',
            formCategory: formCategory?.value || '',
            formMethod: formMethod?.value || ''
        };
        const uniqueSorted = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        refillSelect(filterCategory, uniqueSorted([...activeCategoryNames(), ...projects.map(item => item.category)]), `所有${columnLabel('category')}`, selected.category);
        refillSelect(filterDept, uniqueSorted(projects.map(item => item.dept)), `所有${columnLabel('dept')}`, selected.dept);
        refillSelect(filterStatus, uniqueSorted(projects.map(item => item.status)), `所有${columnLabel('status')}`, selected.status);
        refillSelect(filterHandler, uniqueSorted(projects.map(item => item.handler)), `所有${columnLabel('handler')}`, selected.handler);

        const editingProject = projects.find(item => String(item.id) === String(document.getElementById('edit-id')?.value || ''));
        const formCategories = uniqueSorted([...activeCategoryNames(), editingProject?.category]);
        const formMethods = uniqueSorted([...activeMethodNames(), editingProject?.method]);
        refillSelect(formCategory, formCategories, null, selected.formCategory || editingProject?.category || '');
        refillSelect(formMethod, formMethods, null, selected.formMethod || editingProject?.method || '');
    };

    window.renderCatMethodLists = function () {
        const categoryContainer = document.getElementById('category-list-container');
        const methodContainer = document.getElementById('method-list-container');
        const activeCategories = state.categories.filter(item => Number(item.is_active) === 1);
        const activeMethods = state.methods.filter(item => Number(item.is_active) === 1);
        document.getElementById('cat-count-badge').textContent = `${activeCategories.length}项`;
        document.getElementById('method-count-badge').textContent = `${activeMethods.length}项`;
        const makeRows = (container, records, type) => {
            container.replaceChildren();
            records.forEach((record, index) => {
                const row = document.createElement('div');
                row.className = 'flex justify-between items-center bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs shadow-sm';
                const name = document.createElement('span');
                name.className = 'font-medium text-slate-800';
                name.textContent = record.name;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'text-gray-400 hover:text-red-500 transition p-0.5';
                button.title = type === 'category' ? '停用类别' : '停用方式';
                button.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                button.disabled = !state.permissions.canEdit;
                button.addEventListener('click', () => type === 'category' ? deleteCategory(index) : deleteMethod(index));
                row.append(name, button);
                container.appendChild(row);
            });
        };
        makeRows(categoryContainer, activeCategories, 'category');
        makeRows(methodContainer, activeMethods, 'method');
    };

    window.renderTable = function (data) {
        original.renderTable(data);
        if (!state.permissions.canEdit) {
            document.querySelectorAll('#table-body tr td:last-child button').forEach(button => button.remove());
        }
    };

    function captureFilters() {
        return ['filter-search', 'filter-category', 'filter-dept', 'filter-status', 'filter-handler']
            .reduce((values, id) => ({ ...values, [id]: document.getElementById(id)?.value || '' }), {});
    }

    function restoreFilters(values) {
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element && [...(element.options || [{ value }])].some(optionItem => optionItem.value === value)) element.value = value;
        });
    }

    function applySnapshot(payload) {
        const filters = captureFilters();
        projects = Array.isArray(payload.projects) ? payload.projects : [];
        state.categories = Array.isArray(payload.categories) ? payload.categories : [];
        state.methods = Array.isArray(payload.methods) ? payload.methods : [];
        state.columns = Array.isArray(payload.columns) ? payload.columns : [];
        columnDefinitions = state.columns;
        customColumns = state.columns.filter(column => column.column_type === 'custom');
        categoriesList = activeCategoryNames();
        methodsList = activeMethodNames();
        state.revision = Number(payload.revision || 0);
        state.etag = payload.etag || `"data-${state.revision}"`;
        state.actor = payload.actor || state.actor;
        state.permissions = payload.permissions || state.permissions;
        state.online = true;

        renderColumnSchema();
        initFilterDropdowns();
        restoreFilters(filters);
        applyFilters();
        if (!document.getElementById('view-dash')?.classList.contains('hidden')) renderDashboard();
        document.getElementById('btn-audit-logs')?.classList.toggle('hidden', !state.permissions.canAdmin);
        document.getElementById('btn-audit-logs')?.classList.toggle('flex', state.permissions.canAdmin);
        document.getElementById('btn-column-settings')?.classList.toggle('hidden', !state.permissions.canAdmin);
        document.getElementById('btn-column-settings')?.classList.toggle('flex', state.permissions.canAdmin);
        document.querySelector('button[onclick="openAddModal()"]')?.classList.toggle('hidden', !state.permissions.canEdit);
        if (!document.getElementById('modal-column-settings')?.classList.contains('hidden')) renderColumnSettings();
        setSyncStatus('online', `已同步 · v${state.revision}`);
        updateLegacyBanner();
    }

    async function loadSnapshot({ force = false, silent = false } = {}) {
        if (state.loading) return;
        state.loading = true;
        if (!silent) setSyncStatus('syncing', '正在同步');
        try {
            const result = await ApiClient.snapshot(force ? null : state.etag);
            if (!result.notModified) applySnapshot(result);
            else {
                state.online = true;
                setSyncStatus('online', `已同步 · v${state.revision}`);
            }
            state.lastErrorMessage = '';
        } catch (error) {
            state.online = false;
            setSyncStatus('offline', '连接失败 · 只读');
            if (!silent || error.message !== state.lastErrorMessage) showToast(error.message, 'error');
            state.lastErrorMessage = error.message;
        } finally {
            state.loading = false;
        }
    }

    async function pollVersion() {
        if (document.hidden || state.loading) return;
        try {
            const result = await ApiClient.version(state.etag);
            if (!result.notModified && Number(result.revision) !== state.revision) await loadSnapshot({ force: true, silent: true });
            else if (result.notModified) {
                state.online = true;
                setSyncStatus('online', `已同步 · v${state.revision}`);
            }
        } catch {
            state.online = false;
            setSyncStatus('offline', '连接失败 · 只读');
        }
    }

    function requireWritable() {
        if (!state.permissions.canEdit) {
            showToast('当前账号只有查看权限', 'warning');
            return false;
        }
        if (!state.online) {
            showToast('当前未连接公共数据服务，已阻止离线修改', 'warning');
            return false;
        }
        return true;
    }

    function requireAdminWritable() {
        if (!state.permissions.canAdmin) {
            showToast('只有管理员可以修改表格列', 'warning');
            return false;
        }
        return requireWritable();
    }

    window.initLocalStorage = function () {
        projects = [];
    };
    window.saveToLocalStorage = function () {};
    window.saveCatsToLocalStorage = function () {};
    window.saveMethodsToLocalStorage = function () {};

    window.openAddModal = function () {
        if (!requireWritable()) return;
        state.editingVersion = null;
        state.editRequestId = ApiClient.requestId();
        original.openAddModal();
        initFilterDropdowns();
    };

    window.editProject = function (id) {
        if (!requireWritable()) return;
        const item = projects.find(project => String(project.id) === String(id));
        if (!item) return;
        state.editingVersion = Number(item.version);
        state.editRequestId = ApiClient.requestId();
        original.editProject(id);
    };

    window.closeAddModal = function () {
        state.editingVersion = null;
        state.editRequestId = null;
        original.closeAddModal();
    };

    function readProjectForm() {
        return {
            category: document.getElementById('form-category').value,
            dept: document.getElementById('form-dept').value.trim(),
            name: document.getElementById('form-name').value.trim(),
            method: document.getElementById('form-method').value,
            handler: document.getElementById('form-handler').value.trim(),
            status: document.getElementById('form-status').value.trim(),
            progress: document.getElementById('form-progress').value.trim(),
            remark: document.getElementById('form-remark').value.trim() || '-',
            customValues: readCustomValuesFromForm()
        };
    }

    function setSubmitBusy(busy) {
        const button = document.querySelector('#form-project button[type="submit"]');
        if (!button) return;
        button.disabled = busy;
        button.classList.toggle('opacity-60', busy);
        button.dataset.originalText ||= button.innerHTML;
        button.innerHTML = busy ? '<i class="fa-solid fa-spinner fa-spin me-1"></i>正在保存...' : button.dataset.originalText;
    }

    window.handleFormSubmit = async function (event) {
        event.preventDefault();
        if (!requireWritable()) return;
        const editId = document.getElementById('edit-id').value;
        const project = readProjectForm();
        state.editRequestId ||= ApiClient.requestId();
        setSubmitBusy(true);
        setSyncStatus('saving', '正在保存');
        try {
            if (editId) {
                await ApiClient.updateProject(editId, project, state.editingVersion, state.editRequestId);
            } else {
                await ApiClient.createProject(project, state.editRequestId);
            }
            original.closeAddModal();
            state.editingVersion = null;
            state.editRequestId = null;
            await loadSnapshot({ force: true });
            showToast(editId ? '修改已保存并同步' : '新项目已添加并同步', 'success');
        } catch (error) {
            if (error.status === 409 && error.details?.latest) {
                showConflict(error.details.latest, project);
            } else {
                showToast(error.message, 'error');
            }
            setSyncStatus(state.online ? 'online' : 'offline', state.online ? `已同步 · v${state.revision}` : '连接失败 · 只读');
        } finally {
            setSubmitBusy(false);
        }
    };

    window.deleteProject = async function (id) {
        if (!requireWritable()) return;
        const item = projects.find(project => String(project.id) === String(id));
        if (!item) return;
        if (!confirm(`确定要删除“${item.name}”吗？该操作会写入操作日志。`)) return;
        setSyncStatus('saving', '正在删除');
        try {
            await ApiClient.deleteProject(item.id, Number(item.version));
            await loadSnapshot({ force: true });
            showToast('项目已删除并同步', 'info');
        } catch (error) {
            if (error.status === 409 && error.details?.latest) {
                showToast('删除失败：记录已被其他同事修改，请重新确认', 'warning');
                await loadSnapshot({ force: true });
            } else showToast(error.message, 'error');
        }
    };

    window.addCategory = async function () {
        if (!requireWritable()) return;
        const input = document.getElementById('input-new-category');
        const name = input.value.trim();
        if (!name) return showToast('请输入采购类别名称', 'warning');
        try {
            await ApiClient.createCategory(name);
            input.value = '';
            await loadSnapshot({ force: true });
            renderCatMethodLists();
            showToast(`已新增采购类别：${name}`, 'success');
        } catch (error) { showToast(error.message, error.status === 409 ? 'warning' : 'error'); }
    };

    window.deleteCategory = async function (index) {
        if (!requireWritable()) return;
        const record = state.categories.filter(item => Number(item.is_active) === 1)[index];
        if (!record || !confirm(`确定停用采购类别“${record.name}”吗？历史项目仍会保留该类别。`)) return;
        try {
            await ApiClient.deactivateCategory(record.id, Number(record.version));
            await loadSnapshot({ force: true });
            renderCatMethodLists();
            showToast(`已停用类别：${record.name}`, 'info');
        } catch (error) { showToast(error.message, error.status === 409 ? 'warning' : 'error'); }
    };

    window.addMethod = async function () {
        if (!requireWritable()) return;
        const input = document.getElementById('input-new-method');
        const name = input.value.trim();
        if (!name) return showToast('请输入采购方式名称', 'warning');
        try {
            await ApiClient.createMethod(name);
            input.value = '';
            await loadSnapshot({ force: true });
            renderCatMethodLists();
            showToast(`已新增采购方式：${name}`, 'success');
        } catch (error) { showToast(error.message, error.status === 409 ? 'warning' : 'error'); }
    };

    window.deleteMethod = async function (index) {
        if (!requireWritable()) return;
        const record = state.methods.filter(item => Number(item.is_active) === 1)[index];
        if (!record || !confirm(`确定停用采购方式“${record.name}”吗？历史项目仍会保留该方式。`)) return;
        try {
            await ApiClient.deactivateMethod(record.id, Number(record.version));
            await loadSnapshot({ force: true });
            renderCatMethodLists();
            showToast(`已停用方式：${record.name}`, 'info');
        } catch (error) { showToast(error.message, error.status === 409 ? 'warning' : 'error'); }
    };

    function renderColumnSettings() {
        const container = document.getElementById('column-settings-list');
        if (!container) return;
        container.replaceChildren();
        state.columns.forEach((column, index) => {
            const row = document.createElement('div');
            row.className = 'grid grid-cols-[auto_1fr_auto] gap-3 items-center bg-slate-50 border border-slate-200 rounded-xl p-3';

            const meta = document.createElement('div');
            meta.className = 'w-24';
            const badge = document.createElement('span');
            badge.className = column.column_type === 'fixed'
                ? 'inline-flex px-2 py-1 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700'
                : 'inline-flex px-2 py-1 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700';
            badge.textContent = column.column_type === 'fixed' ? '现有业务列' : '自定义列';
            const order = document.createElement('div');
            order.className = 'text-[10px] text-gray-400 mt-1';
            order.textContent = `第 ${index + 1} 列`;
            meta.append(badge, order);

            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 60;
            input.value = column.name;
            input.dataset.columnNameInput = column.id;
            input.className = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-violet-500 bg-white';

            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'px-3 py-2 rounded-lg bg-white border border-violet-300 text-violet-700 hover:bg-violet-50 text-xs font-semibold whitespace-nowrap';
            save.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i>保存名称';
            save.addEventListener('click', () => renameColumn(column.id));
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    renameColumn(column.id);
                }
            });
            row.append(meta, input, save);
            container.appendChild(row);
        });
    }

    function openColumnModal() {
        if (!requireAdminWritable()) return;
        renderColumnSettings();
        const modal = document.getElementById('modal-column-settings');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeColumnModal() {
        const modal = document.getElementById('modal-column-settings');
        modal?.classList.add('hidden');
        modal?.classList.remove('flex');
    }

    async function addColumn() {
        if (!requireAdminWritable()) return;
        const input = document.getElementById('input-new-column');
        const name = input.value.trim();
        if (!name) return showToast('请输入新列名称', 'warning');
        const button = document.getElementById('btn-add-column');
        button.disabled = true;
        setSyncStatus('saving', '正在新增表格列');
        try {
            await ApiClient.createColumn(name);
            input.value = '';
            await loadSnapshot({ force: true });
            showToast(`已新增表格列：${name}`, 'success');
        } catch (error) {
            showToast(error.message, error.status === 409 ? 'warning' : 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function renameColumn(id) {
        if (!requireAdminWritable()) return;
        const column = state.columns.find(item => item.id === id);
        const input = document.querySelector(`[data-column-name-input="${CSS.escape(id)}"]`);
        const name = input?.value.trim() || '';
        if (!column || !name) return showToast('列名称不能为空', 'warning');
        if (name === column.name) return showToast('列名称没有变化', 'info');
        input.disabled = true;
        setSyncStatus('saving', '正在保存列名称');
        try {
            await ApiClient.updateColumn(column.id, name, Number(column.version));
            await loadSnapshot({ force: true });
            showToast(`列名称已修改为：${name}`, 'success');
        } catch (error) {
            showToast(error.message, error.status === 409 ? 'warning' : 'error');
            if (error.status === 409) await loadSnapshot({ force: true });
        } finally {
            input.disabled = false;
        }
    }

    function showConflict(latest, mine) {
        state.latestConflict = { latest, mine };
        const rows = businessColumns().map(column => {
            const latestValue = column.column_type === 'fixed'
                ? latest[column.field_key]
                : latest.customValues?.[column.id];
            const mineValue = column.column_type === 'fixed'
                ? mine[column.field_key]
                : mine.customValues?.[column.id];
            const differs = String(latestValue ?? '') !== String(mineValue ?? '');
            return `<tr class="${differs ? 'bg-amber-50' : ''}">
                <th class="p-2 border text-left whitespace-nowrap">${escapeHtml(column.name)}</th>
                <td class="p-2 border align-top">${escapeHtml(latestValue)}</td>
                <td class="p-2 border align-top">${escapeHtml(mineValue)}</td>
            </tr>`;
        }).join('');
        document.getElementById('conflict-diff').innerHTML = `
            <table class="w-full border-collapse text-xs">
                <thead><tr class="bg-slate-100"><th class="p-2 border">字段</th><th class="p-2 border">服务器最新版（v${Number(latest.version)}）</th><th class="p-2 border">我的当前内容</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        const modal = document.getElementById('modal-shared-conflict');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function fillForm(project) {
        document.getElementById('form-category').value = project.category;
        document.getElementById('form-dept').value = project.dept;
        document.getElementById('form-name').value = project.name;
        document.getElementById('form-method').value = project.method;
        document.getElementById('form-handler').value = project.handler;
        document.getElementById('form-status').value = project.status;
        document.getElementById('form-progress').value = project.progress;
        document.getElementById('form-remark').value = project.remark;
        renderCustomFieldInputs(project);
    }

    function handleConflictAction(action) {
        const modal = document.getElementById('modal-shared-conflict');
        if (action === 'server' && state.latestConflict) {
            state.editingVersion = Number(state.latestConflict.latest.version);
            state.editRequestId = ApiClient.requestId();
            initFilterDropdowns();
            fillForm(state.latestConflict.latest);
            showToast('已加载服务器最新版', 'info');
        }
        if (action === 'mine' && state.latestConflict) {
            state.editingVersion = Number(state.latestConflict.latest.version);
            state.editRequestId = ApiClient.requestId();
            showToast('已基于最新版保留当前内容，请检查后再次保存', 'warning');
        }
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    async function openAuditLogModal() {
        const modal = document.getElementById('modal-audit-logs');
        const content = document.getElementById('audit-log-content');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        content.innerHTML = '<div class="py-12 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin me-2"></i>正在读取日志...</div>';
        try {
            const result = await ApiClient.auditLogs(200, 0);
            const actionLabels = { create: '新增', update: '修改', delete: '删除', deactivate: '停用', reactivate: '重新启用', import: '导入' };
            const typeLabels = { project: '项目', category: '采购类别', method: '采购方式', column: '表格列', system: '系统' };
            if (!result.logs.length) {
                content.innerHTML = '<div class="py-12 text-center text-slate-500">暂无操作日志</div>';
                return;
            }
            content.innerHTML = `<table class="w-full border-collapse">
                <thead class="sticky top-0 bg-slate-100"><tr>
                    <th class="border p-2 text-left">时间</th><th class="border p-2 text-left">操作者</th>
                    <th class="border p-2">操作</th><th class="border p-2 text-left">对象</th>
                    <th class="border p-2">记录版本</th><th class="border p-2">全局版本</th><th class="border p-2">详情</th>
                </tr></thead><tbody>${result.logs.map(log => `
                    <tr class="hover:bg-slate-50">
                        <td class="border p-2 whitespace-nowrap">${escapeHtml(formatTime(log.created_at))}</td>
                        <td class="border p-2"><div>${escapeHtml(log.actor_name || '-')}</div><div class="text-[10px] text-gray-400">${escapeHtml(log.actor_email)}</div></td>
                        <td class="border p-2 text-center whitespace-nowrap">${escapeHtml(actionLabels[log.action] || log.action)}</td>
                        <td class="border p-2">${escapeHtml(typeLabels[log.entity_type] || log.entity_type)} · ${escapeHtml(log.entity_id)}</td>
                        <td class="border p-2 text-center">${escapeHtml(log.entity_version ?? '-')}</td>
                        <td class="border p-2 text-center">${escapeHtml(log.dataset_version)}</td>
                        <td class="border p-2 text-center"><details class="text-left"><summary class="cursor-pointer text-blue-600">查看</summary><pre class="mt-2 max-w-xl whitespace-pre-wrap break-all text-[10px] bg-slate-50 p-2 rounded">修改前：${escapeHtml(log.before_json || '-')}

修改后：${escapeHtml(log.after_json || '-')}</pre></details></td>
                    </tr>`).join('')}</tbody></table>`;
        } catch (error) {
            content.innerHTML = `<div class="py-12 text-center text-red-600">${escapeHtml(error.message)}</div>`;
        }
    }

    function closeAuditLogModal() {
        const modal = document.getElementById('modal-audit-logs');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    function getLegacyBackup() {
        return {
            projects: safeJsonParse(localStorage.getItem(LEGACY_KEYS.projects), []),
            categories: safeJsonParse(localStorage.getItem(LEGACY_KEYS.categories), []),
            methods: safeJsonParse(localStorage.getItem(LEGACY_KEYS.methods), [])
        };
    }

    function downloadJson(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function exportLegacyBackup() {
        downloadJson(`招采进展_本机旧数据备份_${new Date().toISOString().slice(0, 10)}.json`, {
            exportedAt: new Date().toISOString(),
            source: 'localStorage',
            ...getLegacyBackup()
        });
        showToast('本机旧数据 JSON 备份已导出', 'success');
    }

    function exportPublicBackup() {
        downloadJson(`招采进展_公共数据备份_v${state.revision}_${new Date().toISOString().slice(0, 10)}.json`, {
            exportedAt: new Date().toISOString(),
            source: 'D1',
            revision: state.revision,
            projects,
            categories: state.categories,
            methods: state.methods,
            columns: state.columns
        });
        showToast('公共数据 JSON 备份已导出', 'success');
    }

    async function importLegacyData() {
        const backup = getLegacyBackup();
        if (!backup.projects.length) return showToast('本机没有可导入的旧项目数据', 'warning');
        if (!confirm(`即将把本机 ${backup.projects.length} 条项目导入公共数据库。请确认本机是正式数据源，并且已经导出 JSON 备份。是否继续？`)) return;
        const button = document.getElementById('btn-import-legacy');
        button.disabled = true;
        button.textContent = '正在导入...';
        try {
            await ApiClient.importLegacy(backup);
            localStorage.setItem('procurement_cloud_migrated_at', new Date().toISOString());
            await loadSnapshot({ force: true });
            showToast(`已成功导入 ${backup.projects.length} 条项目`, 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = '导入公共数据库';
        }
    }

    function updateLegacyBanner() {
        const banner = document.getElementById('legacy-import-banner');
        if (!banner) return;
        const legacy = getLegacyBackup();
        const shouldShow = state.permissions.canAdmin && projects.length === 0 && legacy.projects.length > 0;
        banner.classList.toggle('hidden', !shouldShow);
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) pollVersion();
    });
    window.addEventListener('online', () => loadSnapshot({ force: true }));
    window.addEventListener('offline', () => {
        state.online = false;
        setSyncStatus('offline', '浏览器离线 · 只读');
    });

    window.addEventListener('DOMContentLoaded', async () => {
        createUi();
        await loadSnapshot({ force: true });
        state.pollTimer = window.setInterval(pollVersion, 3000);
    });

    window.openAuditLogModal = openAuditLogModal;
    window.closeAuditLogModal = closeAuditLogModal;
    window.openColumnModal = openColumnModal;
    window.closeColumnModal = closeColumnModal;
    window.SharedDataState = state;
})();
