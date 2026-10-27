
/* =====================================================
   QUICKSHIP PH — FUNCTIONAL FRONT-END DEMO
   Features:
   - Login and registration
   - Customer shipment creation
   - Philippine address dropdowns using PSGC API
   - Rider shipment assignment and status updates
   - FCFS, SJF, and Priority scheduling
   - Separate active and completed shipments
   - Package tracking and history
   - Gantt charts for completed shipments
   Data is stored in browser localStorage.
===================================================== */

"use strict";

/* =====================================================
   STORAGE AND GLOBAL VARIABLES
===================================================== */

const USERS_KEY = "quickship_users";
const PACKAGES_KEY = "quickship_packages";
const SESSION_KEY = "quickship_current_user";
const PSGC_API = "https://psgc.cloud/api/v2";

let currentUser = readJSON(SESSION_KEY, null);
let riderSchedulingMode =
    localStorage.getItem("quickship_rider_scheduling_mode") || "FCFS";

const addressState = {
    sender: { provinceRequired: true, requestVersion: 0 },
    delivery: { provinceRequired: true, requestVersion: 0 }
};

function readJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch (error) {
        console.error(`Could not read ${key}:`, error);
        return fallback;
    }
}

function getUsers() {
    return readJSON(USERS_KEY, []);
}

function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getPackages() {
    return readJSON(PACKAGES_KEY, []);
}

function savePackages(packages) {
    localStorage.setItem(PACKAGES_KEY, JSON.stringify(packages));
}

function saveCurrentUser(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function byId(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
}

function show(id) {
    byId(id)?.classList.remove("hidden");
}

function hide(id) {
    byId(id)?.classList.add("hidden");
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function makeTrackingNumber() {
    return "QS" +
        Date.now().toString().slice(-8) +
        Math.random().toString(36).slice(2, 5).toUpperCase();
}

function formatDate(value) {
    if (!value) return "Not scheduled";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleString();
}

function roleLabel(role) {
    return ({
        customer: "Sender",
        rider: "Delivery Rider"
    })[role] || role || "Sender";
}

function statusSteps() {
    return [
        "Shipment created",
        "Picked up",
        "In transit",
        "Out for delivery",
        "Delivered",
        "Completed"
    ];
}

function isCompletedShipment(shipment) {
    return ["Delivered", "Completed"].includes(shipment.status);
}

function priorityRank(priority) {
    return ({
        Express: 1,
        Urgent: 2,
        Normal: 3
    })[priority] || 3;
}

function priorityLabel(priority) {
    return ({
        Express: "Express",
        Urgent: "Urgent",
        Normal: "Normal"
    })[priority] || "Normal";
}

/* =====================================================
   SHIPMENT SCHEDULING
===================================================== */

function sortShipments(shipments, mode = "PRIORITY") {
    return [...shipments].sort((a, b) => {
        if (mode === "FCFS") {
            return new Date(a.createdAt || 0).getTime() -
                new Date(b.createdAt || 0).getTime();
        }

        if (mode === "SJF") {
            const timeA = Number(a.estimatedTravelTime);
            const timeB = Number(b.estimatedTravelTime);

            const validA = Number.isFinite(timeA) && timeA > 0;
            const validB = Number.isFinite(timeB) && timeB > 0;

            if (validA && validB && timeA !== timeB) {
                return timeA - timeB;
            }

            if (validA !== validB) {
                return validA ? -1 : 1;
            }

            return new Date(a.createdAt || 0).getTime() -
                new Date(b.createdAt || 0).getTime();
        }

        const difference =
            priorityRank(a.priority) - priorityRank(b.priority);

        if (difference) return difference;

        return new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime();
    });
}

function chooseSchedulingMode(mode) {
    if (!["FCFS", "SJF", "PRIORITY"].includes(mode)) return;

    riderSchedulingMode = mode;

    localStorage.setItem("quickship_rider_scheduling_mode", mode);

    if (currentUser?.role === "customer") {
        renderCustomerDashboard();
    } else if (currentUser?.role === "rider") {
        renderRiderDashboard();
    }
}
/* =====================================================
   NAVIGATION AND AUTHENTICATION
===================================================== */

function switchAuth(type) {
    const loginForm = byId("loginForm");
    const registerForm = byId("registerForm");

    if (!loginForm || !registerForm) return;

    const isLogin = type === "login";

    loginForm.classList.toggle("hidden", !isLogin);
    registerForm.classList.toggle("hidden", isLogin);

    byId("loginTab")?.classList.toggle("active", isLogin);
    byId("registerTab")?.classList.toggle("active", !isLogin);

    setText("loginMessage", "");
    setText("registerMessage", "");
}

function goToAuthPage() {
    hide("landingPage");
    hide("customerPage");
    hide("riderPage");
    hide("trackingPage");
    hide("successPage");

    show("authPage");
    switchAuth("login");
}

function showLandingPage() {
    hide("authPage");
    hide("customerPage");
    hide("riderPage");
    hide("trackingPage");
    hide("successPage");

    show("landingPage");
    renderNavigation();
}

function logout() {
    localStorage.removeItem(SESSION_KEY);
    currentUser = null;
    showLandingPage();
}

function renderNavigation() {
    const nav = byId("navigation");
    if (!nav) return;

    if (!currentUser) {
        nav.innerHTML = "";
        return;
    }

    nav.innerHTML = `
        <span class="muted">
            Hi, ${escapeHTML(currentUser.name)}
        </span>

        <button type="button" onclick="renderApplication()">
            Dashboard
        </button>

        <button type="button" onclick="showTracking()">
            Track Package
        </button>

        <button type="button" onclick="logout()">
            Log out
        </button>
    `;
}

function register(event) {
    event?.preventDefault();

    const name = (byId("registerName")?.value || "").trim();
    const email = (byId("registerEmail")?.value || "")
        .trim().toLowerCase();
    const password = byId("registerPassword")?.value || "";
    const phone = (byId("registerPhone")?.value || "").trim();
    const role = byId("registerRole")?.value === "rider"
        ? "rider"
        : "customer";

    const message = byId("registerMessage");

    if (!name || !email || !password || !phone) {
        if (message) {
            message.textContent = "Please complete all required fields.";
        }
        return;
    }

    if (password.length < 6) {
        if (message) {
            message.textContent =
                "Password must be at least 6 characters.";
        }
        return;
    }

    const users = getUsers();

    if (users.some(user =>
        String(user.email).toLowerCase() === email
    )) {
        if (message) {
            message.textContent =
                "This email is already registered. Please sign in instead.";
        }
        return;
    }

    const user = {
        id: Date.now(),
        name,
        email,
        password,
        phone,
        role,
        createdAt: new Date().toISOString()
    };

    users.push(user);
    saveUsers(users);

    currentUser = user;
    saveCurrentUser(user);

    byId("registerForm")?.reset();

    renderApplication();
}

function login(event) {
    event?.preventDefault();

    const email = (byId("loginEmail")?.value || "")
        .trim().toLowerCase();
    const password = byId("loginPassword")?.value || "";

    const user = getUsers().find(item =>
        String(item.email).toLowerCase() === email &&
        item.password === password
    );

    const message = byId("loginMessage");

    if (!user) {
        if (message) {
            message.textContent = "Invalid email or password.";
            message.classList.add("login-error");
        }
        return;
    }

    currentUser = user;
    saveCurrentUser(user);

    byId("loginForm")?.reset();

    renderApplication();
}

function renderApplication() {
    if (!currentUser) {
        showLandingPage();
        return;
    }

    hide("landingPage");
    hide("authPage");
    hide("customerPage");
    hide("riderPage");
    hide("trackingPage");
    hide("successPage");

    renderNavigation();

    if (currentUser.role === "rider") {
        show("riderPage");
        renderRiderDashboard();
    } else {
        show("customerPage");
        renderCustomerDashboard();
        initializeDeliveryAddress();
    }
}

/* =====================================================
   PHILIPPINE ADDRESS DROPDOWNS
===================================================== */

function getListPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) {
        return payload.data;
    }
    return [];
}

async function fetchPSGCList(path) {
    const response = await fetch(`${PSGC_API}${path}`);

    if (!response.ok) {
        throw new Error(`Location service returned ${response.status}`);
    }

    return getListPayload(await response.json());
}

function addressId(prefix, part) {
    return `${prefix}${part}`;
}

function setAddressOptions(select, items, placeholder) {
    if (!select) return;

    select.replaceChildren();

    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);

    items.slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .forEach(item => {
            const option = document.createElement("option");
            option.value = item.code || item.name;
            option.textContent = item.name;
            select.appendChild(option);
        });
}

function resetAddressSelect(
    prefix,
    part,
    placeholder,
    disabled = true
) {
    const select = byId(addressId(prefix, part));
    if (!select) return;

    setAddressOptions(select, [], placeholder);
    select.disabled = disabled;
}

function showAddressError(prefix, message) {
    setText(`${prefix}AddressMessage`, message);
}

async function loadAddressRegions(prefix) {
    const select = byId(addressId(prefix, "Region"));
    if (!select) return;

    select.disabled = true;
    setAddressOptions(select, [], "Loading regions...");

    try {
        const regions = await fetchPSGCList("/regions");

        setAddressOptions(select, regions, "Select region");
        select.disabled = false;
    } catch (error) {
        setAddressOptions(select, [], "Could not load regions");

        showAddressError(
            prefix,
            "Unable to load Philippine regions. Check your internet connection and refresh."
        );

        console.error(`Could not load ${prefix} regions:`, error);
    }
}

async function onAddressRegionChange(prefix) {
    const state = addressState[prefix];
    const version = ++state.requestVersion;

    const region =
        byId(addressId(prefix, "Region"))?.value || "";

    const provinceSelect =
        byId(addressId(prefix, "Province"));

    resetAddressSelect(prefix, "Province", "Select province");
    resetAddressSelect(prefix, "City", "Select city / municipality");
    resetAddressSelect(prefix, "Barangay", "Select barangay");

    state.provinceRequired = true;

    if (provinceSelect) provinceSelect.required = true;

    updateAddress(prefix);

    if (!region) return;

    showAddressError(prefix, "");

    try {
        const encoded = encodeURIComponent(region);
        const provinces = await fetchPSGCList(
            `/regions/${encoded}/provinces`
        );

        if (version !== state.requestVersion) return;

        if (provinces.length) {
            setAddressOptions(
                provinceSelect,
                provinces,
                "Select province"
            );

            provinceSelect.disabled = false;
            provinceSelect.required = true;
        } else {
            state.provinceRequired = false;

            if (provinceSelect) {
                provinceSelect.required = false;
                provinceSelect.disabled = true;

                setAddressOptions(
                    provinceSelect,
                    [],
                    "Not applicable for this region"
                );
            }

            const cities = await fetchPSGCList(
                `/regions/${encoded}/cities-municipalities`
            );

            if (version !== state.requestVersion) return;

            const citySelect = byId(addressId(prefix, "City"));

            setAddressOptions(
                citySelect,
                cities,
                "Select city / municipality"
            );

            if (citySelect) {
                citySelect.disabled = cities.length === 0;
            }
        }
    } catch (error) {
        showAddressError(
            prefix,
            "Unable to load provinces or cities. Please try again."
        );

        console.error(`Could not load ${prefix} locations:`, error);
    }
}

async function onAddressProvinceChange(prefix) {
    const state = addressState[prefix];
    const version = ++state.requestVersion;

    const province =
        byId(addressId(prefix, "Province"))?.value || "";

    resetAddressSelect(prefix, "City", "Select city / municipality");
    resetAddressSelect(prefix, "Barangay", "Select barangay");

    updateAddress(prefix);

    if (!province) return;

    showAddressError(prefix, "");

    try {
        const cities = await fetchPSGCList(
            `/provinces/${encodeURIComponent(province)}/cities-municipalities`
        );

        if (version !== state.requestVersion) return;

        const citySelect = byId(addressId(prefix, "City"));

        setAddressOptions(
            citySelect,
            cities,
            "Select city / municipality"
        );

        if (citySelect) citySelect.disabled = cities.length === 0;
    } catch (error) {
        showAddressError(
            prefix,
            "Unable to load cities or municipalities. Please try again."
        );

        console.error(`Could not load ${prefix} cities:`, error);
    }
}

async function onAddressCityChange(prefix) {
    const state = addressState[prefix];
    const version = ++state.requestVersion;

    const city = byId(addressId(prefix, "City"))?.value || "";

    resetAddressSelect(prefix, "Barangay", "Select barangay");
    updateAddress(prefix);

    if (!city) return;

    showAddressError(prefix, "");

    try {
        const barangays = await fetchPSGCList(
            `/cities-municipalities/${encodeURIComponent(city)}/barangays`
        );

        if (version !== state.requestVersion) return;

        const barangaySelect =
            byId(addressId(prefix, "Barangay"));

        setAddressOptions(
            barangaySelect,
            barangays,
            "Select barangay"
        );

        if (barangaySelect) {
            barangaySelect.disabled = barangays.length === 0;
        }
    } catch (error) {
        showAddressError(
            prefix,
            "Unable to load barangays. Please try again."
        );

        console.error(`Could not load ${prefix} barangays:`, error);
    }
}

function updateAddress(prefix) {
    const parts = ["Region", "Province", "City", "Barangay"]
        .map(part => byId(addressId(prefix, part)))
        .filter(select => select && !select.disabled && select.value)
        .map(select =>
            select.selectedOptions?.[0]?.textContent || select.value
        );

    const street = byId(addressId(prefix, "Street"));

    if (street?.value.trim()) {
        parts.push(street.value.trim());
    }

    const hiddenAddress = byId(
        prefix === "sender" ? "pickupAddress" : "deliveryAddress"
    );

    if (hiddenAddress) {
        hiddenAddress.value = parts.join(", ");
    }
}

function validateAddress(prefix) {
    const region =
        byId(addressId(prefix, "Region"))?.value || "";
    const province =
        byId(addressId(prefix, "Province"))?.value || "";
    const city =
        byId(addressId(prefix, "City"))?.value || "";
    const barangay =
        byId(addressId(prefix, "Barangay"))?.value || "";
    const street =
        (byId(addressId(prefix, "Street"))?.value || "").trim();

    const state = addressState[prefix];

    if (
        !region ||
        (state.provinceRequired && !province) ||
        !city ||
        !barangay ||
        !street
    ) {
        showAddressError(
            prefix,
            `Please select the ${prefix} region, province (if applicable), city/municipality, barangay, and enter the street and house number.`
        );

        return false;
    }

    showAddressError(prefix, "");
    updateAddress(prefix);

    return true;
}

function initializeAddress(prefix) {
    const region = byId(addressId(prefix, "Region"));

    if (!region || region.dataset.addressInitialized === "true") {
        return;
    }

    const province = byId(addressId(prefix, "Province"));
    const city = byId(addressId(prefix, "City"));
    const barangay = byId(addressId(prefix, "Barangay"));
    const street = byId(addressId(prefix, "Street"));

    if (!province || !city || !barangay || !street) return;

    region.dataset.addressInitialized = "true";

    region.addEventListener("change", () =>
        onAddressRegionChange(prefix)
    );

    province.addEventListener("change", () =>
        onAddressProvinceChange(prefix)
    );

    city.addEventListener("change", () =>
        onAddressCityChange(prefix)
    );

    barangay.addEventListener("change", () =>
        updateAddress(prefix)
    );

    street.addEventListener("input", () =>
        updateAddress(prefix)
    );

    loadAddressRegions(prefix);
}

function initializeDeliveryAddress() {
    initializeAddress("sender");
    initializeAddress("delivery");
}

function resetAddress(prefix) {
    ["Region", "Province", "City", "Barangay"]
        .forEach((part, index) => {
            const select = byId(addressId(prefix, part));

            if (select) {
                select.selectedIndex = 0;
                select.disabled = index !== 0;
            }
        });

    const street = byId(addressId(prefix, "Street"));

    if (street) street.value = "";

    addressState[prefix].provinceRequired = true;
    addressState[prefix].requestVersion++;

    const province = byId(addressId(prefix, "Province"));

    if (province) province.required = true;

    updateAddress(prefix);
    showAddressError(prefix, "");
}

/* =====================================================
   CUSTOMER DASHBOARD AND SHIPMENT CREATION
===================================================== */

function createShipment(event) {
    event?.preventDefault();

    if (!currentUser) {
        goToAuthPage();
        return;
    }

    if (!validateAddress("sender")) return;
    if (!validateAddress("delivery")) return;

    const senderName = (byId("senderName")?.value || "").trim();
    const senderPhone = (byId("senderPhone")?.value || "").trim();
    const recipient = (byId("recipientName")?.value || "").trim();
    const recipientPhone = (byId("recipientPhone")?.value || "").trim();
    const pickup = (byId("pickupAddress")?.value || "").trim();
    const description = (byId("shipmentDescription")?.value || "").trim();
    const size = byId("packageSize")?.value || "Small";
    const priority = byId("shipmentPriority")?.value || "Normal";
    const travelTime = Number(byId("estimatedTravelTime")?.value);
    const delivery = (byId("deliveryAddress")?.value || "").trim();

    if (
        !senderName ||
        !senderPhone ||
        !recipient ||
        !recipientPhone ||
        !pickup ||
        !delivery ||
        !description ||
        !Number.isFinite(travelTime) ||
        travelTime < 1
    ) {
        setText(
            "shipmentMessage",
            "Please complete all required fields and enter an estimated travel time of at least 1 minute."
        );
        return;
    }

    const trackingNumber = makeTrackingNumber();
    const createdAt = new Date().toISOString();

    const shipment = {
        id: trackingNumber,
        trackingNumber,
        senderId: currentUser.id,
        senderName,
        senderPhone,
        senderEmail: currentUser.email,
        recipient,
        recipientPhone,
        pickupAddress: pickup,
        deliveryAddress: delivery,
        description,
        size,
        priority,
        estimatedTravelTime: travelTime,
        createdAt,
        status: "Shipment created",
        riderId: null,
        riderName: null,
        history: [{
            status: "Shipment created",
            at: createdAt,
            note: "Shipment request created."
        }]
    };

    const packages = getPackages();
    packages.unshift(shipment);
    savePackages(packages);

    byId("shipmentForm")?.reset();

    resetAddress("sender");
    resetAddress("delivery");

    setText("shipmentMessage", "");

    showShipmentSuccess(shipment);
    renderCustomerDashboard();
}

function showShipmentSuccess(shipment) {
    hide("customerPage");
    hide("riderPage");
    hide("trackingPage");

    show("successPage");

    setText("successTrackingNumber", shipment.trackingNumber);
    setText("successRecipient", shipment.recipient);
    setText("successAddress", shipment.deliveryAddress);

    renderNavigation();
}

function backToDashboard() {
    hide("successPage");
    renderApplication();
}

/* Customer/sender dashboard with scheduling controls
   and separate active and completed shipments. */

function renderCustomerDashboard() {
    if (!currentUser || currentUser.role !== "customer") return;

    setText("customerWelcome", `Welcome, ${currentUser.name}`);

    const list = byId("customerPackages");
    if (!list) return;

    const ownedPackages = getPackages().filter(
        item => item.senderId === currentUser.id
    );

    const active = sortShipments(
        ownedPackages.filter(item => !isCompletedShipment(item)),
        riderSchedulingMode
    );

    const completed = sortShipments(
        ownedPackages.filter(item => isCompletedShipment(item)),
        riderSchedulingMode
    );

    setText("customerPackageCount", ownedPackages.length);

    const descriptions = {
        FCFS: "First-Come, First-Served",
        SJF: "Shortest Job First",
        PRIORITY: "Priority Scheduling"
    };

    const explanations = {
        FCFS: "Older shipment requests appear first.",
        SJF: "Shipments with the shortest estimated travel time appear first.",
        PRIORITY: "Express shipments appear first, followed by Urgent and Normal."
    };

    const modes = `
        <div class="scheduling-controls" role="group"
             aria-label="Shipment scheduling algorithm">
            <p><strong>Choose Shipment Scheduling</strong></p>

            ${["FCFS", "SJF", "PRIORITY"].map(mode => `
                <button type="button"
                    class="${riderSchedulingMode === mode ? "active" : ""}"
                    aria-pressed="${riderSchedulingMode === mode}"
                    onclick="chooseSchedulingMode('${mode}')">
                    ${mode === "PRIORITY" ? "Priority" : mode}
                </button>
            `).join("")}

            <div class="scheduling-description">
                <strong>${descriptions[riderSchedulingMode]}</strong>
                <p>${explanations[riderSchedulingMode]}</p>
            </div>
        </div>
    `;

    function customerShipmentCard(item, index, isDone) {
        const priority = priorityLabel(item.priority);
        const priorityClass = `priority-${priority.toLowerCase()}`;
        const detailsId = `customer-details-${index}-${String(item.trackingNumber).replace(/[^a-zA-Z0-9_-]/g, "")}`;

        return `
            <article class="queue-card unified-shipment-card">
                <div class="queue-card-top">
                    <div>
                        <span class="queue-number">
                            ${isDone ? "COMPLETED SHIPMENT" : "SHIPMENT"} #${index + 1}
                        </span>

                        <h3>${escapeHTML(item.trackingNumber)}</h3>

                        <p class="muted">
                            ${escapeHTML(item.description || "No description")}
                            · ${escapeHTML(item.size || "Size not specified")}
                        </p>
                    </div>

                    <span class="status-badge">
                        ${escapeHTML(item.status || "Shipment created")}
                    </span>
                </div>

                <div class="queue-metrics">
                    <div class="queue-metric">
                        <span>Priority</span>
                        <strong>
                            <span class="priority-badge ${priorityClass}">
                                ${escapeHTML(priority)}
                            </span>
                        </strong>
                    </div>

                    <div class="queue-metric">
                        <span>Estimated Travel Time</span>
                        <strong>
                            ${Number(item.estimatedTravelTime) > 0
                                ? `${escapeHTML(item.estimatedTravelTime)} minutes`
                                : "Not provided"}
                        </strong>
                    </div>

                    <div class="queue-metric">
                        <span>Date and Time Created</span>
                        <strong>${escapeHTML(formatDate(item.createdAt))}</strong>
                    </div>

                    <div class="queue-metric">
                        <span>Assigned Rider</span>
                        <strong>${escapeHTML(item.riderName || "Not assigned yet")}</strong>
                    </div>
                </div>

                <details class="shipment-full-details" id="${escapeHTML(detailsId)}">
                    <summary>View Complete Shipment Information</summary>

                    <div class="shipment-details-grid">
                        <section class="shipment-info-group">
                            <h4>Sender Information</h4>
                            <p><span>Name</span><strong>${escapeHTML(item.senderName || "Not provided")}</strong></p>
                            <p><span>Phone</span><strong>${escapeHTML(item.senderPhone || "Not provided")}</strong></p>
                            <p><span>Email</span><strong>${escapeHTML(item.senderEmail || "Not provided")}</strong></p>
                        </section>

                        <section class="shipment-info-group">
                            <h4>Recipient Information</h4>
                            <p><span>Name</span><strong>${escapeHTML(item.recipient || "Not provided")}</strong></p>
                            <p><span>Phone</span><strong>${escapeHTML(item.recipientPhone || "Not provided")}</strong></p>
                        </section>

                        <section class="shipment-info-group">
                            <h4>Pickup Information</h4>
                            <p><span>Pickup Address</span><strong>${escapeHTML(item.pickupAddress || "Not provided")}</strong></p>
                        </section>

                        <section class="shipment-info-group">
                            <h4>Delivery Information</h4>
                            <p><span>Delivery Address</span><strong>${escapeHTML(item.deliveryAddress || "Not provided")}</strong></p>
                        </section>

                        <section class="shipment-info-group">
                            <h4>Package Information</h4>
                            <p><span>Description</span><strong>${escapeHTML(item.description || "Not provided")}</strong></p>
                            <p><span>Package Size</span><strong>${escapeHTML(item.size || "Not specified")}</strong></p>
                            <p><span>Priority</span><strong>${escapeHTML(priority)}</strong></p>
                            <p><span>Tracking Number</span><strong>${escapeHTML(item.trackingNumber)}</strong></p>
                        </section>
                    </div>
                </details>

                <div class="queue-actions">
                    <button type="button"
                        onclick="trackPackage('${escapeHTML(item.trackingNumber)}')">
                        Track Shipment
                    </button>

                    ${!isDone ? `
                        <button type="button"
                            class="delete-button"
                            onclick="deleteShipment('${escapeHTML(item.trackingNumber)}')">
                            Delete Shipment
                        </button>
                    ` : ""}
                </div>
            </article>
        `;
    }

    list.innerHTML = modes + `
        <section class="shipment-section">
            <div class="section-heading">
                <h2>Active Shipments</h2>
                <span class="gantt-count">${active.length} shipment(s)</span>
            </div>

            ${active.length
                ? active.map((item, index) =>
                    customerShipmentCard(item, index, false)
                ).join("")
                : '<p class="muted">You have no active shipments.</p>'}
        </section>

        <section class="shipment-section">
            <div class="section-heading">
                <h2>Completed Shipments</h2>
                <span class="gantt-count">${completed.length} shipment(s)</span>
            </div>

            ${completed.length
                ? completed.map((item, index) =>
                    customerShipmentCard(item, index, true)
                ).join("")
                : '<p class="muted">You have no completed shipments yet.</p>'}
        </section>
    `;
}


function deleteShipment(trackingNumber) {
    if (!currentUser) return;

    const item = getPackages().find(
        pkg => pkg.trackingNumber === trackingNumber
    );

    if (!item || item.senderId !== currentUser.id) {
        alert("You are not allowed to delete this shipment.");
        return;
    }

    if (!confirm(`Delete shipment ${trackingNumber}?`)) return;

    savePackages(
        getPackages().filter(
            pkg => pkg.trackingNumber !== trackingNumber
        )
    );

    renderCustomerDashboard();
}

/* =====================================================
   RIDER DASHBOARD
   ACTIVE AND COMPLETED SHIPMENTS ARE SEPARATE
===================================================== */

function shipmentFullDetails(item) {
    const safe = (value) => {
        const text = value === undefined || value === null || value === ""
            ? "Not provided"
            : String(value);

        return text.replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    };

    return `
        <details class="shipment-full-details">
            <summary>View Complete Shipment Information</summary>

            <div class="shipment-details-grid">
                <section class="shipment-info-group">
                    <h4>Sender Information</h4>
                    <p><strong>Name:</strong> ${safe(item.senderName)}</p>
                    <p><strong>Contact:</strong> ${safe(item.senderContact)}</p>
                    <p><strong>Pickup Address:</strong> ${safe(item.pickupAddress)}</p>
                </section>

                <section class="shipment-info-group">
                    <h4>Recipient Information</h4>
                    <p><strong>Name:</strong> ${safe(item.recipientName)}</p>
                    <p><strong>Contact:</strong> ${safe(item.recipientContact)}</p>
                    <p><strong>Delivery Address:</strong> ${safe(item.deliveryAddress)}</p>
                </section>

                <section class="shipment-info-group">
                    <h4>Package Information</h4>
                    <p><strong>Description:</strong> ${safe(item.description)}</p>
                    <p><strong>Package Size:</strong> ${safe(item.packageSize)}</p>
                    <p><strong>Priority:</strong> ${safe(item.priority)}</p>
                    <p><strong>Estimated Travel Time:</strong> ${safe(item.estimatedTravelTime)}</p>
                    <p><strong>Tracking Number:</strong> ${safe(item.trackingNumber)}</p>
                </section>
            </div>
        </details>
    `;
}


function renderRiderDashboard() {
    if (!currentUser || currentUser.role !== "rider") return;

    setText("riderWelcome", `Welcome, ${currentUser.name}`);

    const allShipments = getPackages();

    // Active shipments: available shipments and shipments assigned to this rider.
    const activeShipments = allShipments.filter(item =>
        (!item.riderId || item.riderId === currentUser.id) &&
        !isCompletedShipment(item)
    );

    // Completed shipments: only those assigned to this rider.
    const completedShipments = allShipments.filter(item =>
        item.riderId === currentUser.id &&
        isCompletedShipment(item)
    );

    const activePackages = sortShipments(
        activeShipments,
        riderSchedulingMode
    );

    const completedPackages = sortShipments(
        completedShipments,
        riderSchedulingMode
    );

    const list = byId("riderPackages");
    if (!list) return;

    const descriptions = {
        FCFS: "First-Come, First-Served",
        SJF: "Shortest Job First",
        PRIORITY: "Priority Scheduling"
    };

    const explanations = {
        FCFS: "Older shipment requests appear first.",
        SJF: "Shipments with the shortest estimated travel time appear first.",
        PRIORITY: "Express shipments appear first, followed by Urgent and Normal."
    };

    // Scheduling controls
    const modes = `
        <div class="scheduling-controls" role="group"
             aria-label="Shipment scheduling algorithm">
            <p><strong>Choose Scheduling Algorithm</strong></p>

            ${["FCFS", "SJF", "PRIORITY"].map(mode => `
                <button type="button"
                    class="${riderSchedulingMode === mode ? "active" : ""}"
                    aria-pressed="${riderSchedulingMode === mode}"
                    onclick="chooseSchedulingMode('${mode}')">
                    ${mode === "PRIORITY" ? "Priority" : mode}
                </button>
            `).join("")}

            <div class="scheduling-description">
                <strong>${descriptions[riderSchedulingMode]}</strong>
                <p>${explanations[riderSchedulingMode]}</p>
            </div>
        </div>
    `;

    // Dashboard statistics
    setText(
        "availableCount",
        allShipments.filter(item =>
            !item.riderId && !isCompletedShipment(item)
        ).length
    );

    setText(
        "assignedCount",
        allShipments.filter(item =>
            item.riderId === currentUser.id &&
            !isCompletedShipment(item)
        ).length
    );

    setText("completedCount", completedShipments.length);

    // Create cards using the same general layout as the customer dashboard.
    function renderShipmentCards(packages, isCompleted, sectionPrefix) {
        if (!packages.length) {
            return `
                <div class="queue-empty">
                    <p>${isCompleted
                        ? "No completed shipments yet."
                        : "No active shipments available."}</p>
                </div>
            `;
        }

        return `
            <div class="shipment-queue">
                ${packages.map((item, index) => {
                    const isAssigned = item.riderId === currentUser.id;

                    const priority = priorityLabel(item.priority);
                    const priorityClass =
                        `priority-${priority.toLowerCase()}`;

                    const trackingNumber =
                        String(item.trackingNumber || item.id || "");

                    const safeTrackingNumber =
                        escapeHTML(trackingNumber);

                    const safeId = trackingNumber.replace(
                        /[^a-zA-Z0-9_-]/g,
                        ""
                    );

                    const detailsId =
                        `rider-details-${sectionPrefix}-${safeId}`;

                    const selectId =
                        `rider-status-${sectionPrefix}-${safeId}`;

                    const travelTime =
                        Number(item.estimatedTravelTime);

                    // Show the scheduling information relevant to the chosen algorithm.
                    let schedulingInfo = "";

                    if (riderSchedulingMode === "FCFS") {
                        schedulingInfo = `
                            <div class="queue-metric">
                                <span>Date and Time Created</span>
                                <strong>${escapeHTML(
                                    formatDate(item.createdAt)
                                )}</strong>
                            </div>
                        `;
                    } else if (riderSchedulingMode === "SJF") {
                        schedulingInfo = `
                            <div class="queue-metric">
                                <span>Estimated Travel Time</span>
                                <strong>${
                                    Number.isFinite(travelTime) &&
                                    travelTime > 0
                                        ? `${escapeHTML(travelTime)} minutes`
                                        : "Not provided"
                                }</strong>
                            </div>
                        `;
                    } else {
                        schedulingInfo = `
                            <div class="queue-metric">
                                <span>Priority</span>
                                <strong>
                                    <span class="priority-badge ${priorityClass}">
                                        ${escapeHTML(priority)}
                                    </span>
                                </strong>
                            </div>
                        `;
                    }

                    return `
                        <article class="queue-card unified-shipment-card">

                            <div class="queue-card-top">
                                <div>
                                    <span class="queue-number">
                                        ${isCompleted
                                            ? "COMPLETED SHIPMENT"
                                            : "SHIPMENT"} #${index + 1}
                                    </span>

                                    <h3>${safeTrackingNumber}</h3>

                                    <p class="muted">
                                        ${escapeHTML(
                                            item.description || "No description"
                                        )}
                                        ·
                                        ${escapeHTML(
                                            item.size || "Size not specified"
                                        )}
                                    </p>
                                </div>

                                <span class="status-badge">
                                    ${escapeHTML(
                                        item.status || "Shipment created"
                                    )}
                                </span>
                            </div>

                            <div class="queue-metrics">
                                ${schedulingInfo}

                                <div class="queue-metric">
                                    <span>Estimated Travel Time</span>
                                    <strong>${
                                        Number.isFinite(travelTime) &&
                                        travelTime > 0
                                            ? `${escapeHTML(travelTime)} minutes`
                                            : "Not provided"
                                    }</strong>
                                </div>

                                <div class="queue-metric">
                                    <span>Date and Time Created</span>
                                    <strong>${escapeHTML(
                                        formatDate(item.createdAt)
                                    )}</strong>
                                </div>

                                <div class="queue-metric">
                                    <span>Assigned Rider</span>
                                    <strong>${escapeHTML(
                                        item.riderName || "Not assigned yet"
                                    )}</strong>
                                </div>
                            </div>

                            <details class="shipment-full-details"
                                     id="${escapeHTML(detailsId)}">

                                <summary>
                                    View Complete Shipment Information
                                </summary>

                                <div class="shipment-details-grid">

                                    <section class="shipment-info-group">
                                        <h4>Sender Information</h4>

                                        <p>
                                            <span>Name</span>
                                            <strong>${escapeHTML(
                                                item.senderName || "Not provided"
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Phone</span>
                                            <strong>${escapeHTML(
                                                item.senderPhone || "Not provided"
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Email</span>
                                            <strong>${escapeHTML(
                                                item.senderEmail || "Not provided"
                                            )}</strong>
                                        </p>
                                    </section>

                                    <section class="shipment-info-group">
                                        <h4>Recipient Information</h4>

                                        <p>
                                            <span>Name</span>
                                            <strong>${escapeHTML(
                                                item.recipient || "Not provided"
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Phone</span>
                                            <strong>${escapeHTML(
                                                item.recipientPhone || "Not provided"
                                            )}</strong>
                                        </p>
                                    </section>

                                    <section class="shipment-info-group">
                                        <h4>Pickup Information</h4>

                                        <p>
                                            <span>Pickup Address</span>
                                            <strong>${escapeHTML(
                                                item.pickupAddress || "Not provided"
                                            )}</strong>
                                        </p>
                                    </section>

                                    <section class="shipment-info-group">
                                        <h4>Delivery Information</h4>

                                        <p>
                                            <span>Delivery Address</span>
                                            <strong>${escapeHTML(
                                                item.deliveryAddress || "Not provided"
                                            )}</strong>
                                        </p>
                                    </section>

                                    <section class="shipment-info-group">
                                        <h4>Package Information</h4>

                                        <p>
                                            <span>Description</span>
                                            <strong>${escapeHTML(
                                                item.description || "Not provided"
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Package Size</span>
                                            <strong>${escapeHTML(
                                                item.size || "Not specified"
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Priority</span>
                                            <strong>${escapeHTML(priority)}</strong>
                                        </p>

                                        <p>
                                            <span>Estimated Travel Time</span>
                                            <strong>${
                                                Number.isFinite(travelTime) &&
                                                travelTime > 0
                                                    ? `${escapeHTML(travelTime)} minutes`
                                                    : "Not provided"
                                            }</strong>
                                        </p>

                                        <p>
                                            <span>Date Created</span>
                                            <strong>${escapeHTML(
                                                formatDate(item.createdAt)
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Tracking Number</span>
                                            <strong>${safeTrackingNumber}</strong>
                                        </p>

                                        <p>
                                            <span>Assigned Rider</span>
                                            <strong>${escapeHTML(
                                                item.riderName || "Not assigned yet"
                                            )}</strong>
                                        </p>

                                        <p>
                                            <span>Current Status</span>
                                            <strong>${escapeHTML(
                                                item.status || "Shipment created"
                                            )}</strong>
                                        </p>
                                    </section>
                                </div>
                            </details>

                            ${isCompleted ? `
                                <div class="queue-actions">
                                    <span class="status-badge">
                                        Shipment completed
                                    </span>
                            ` : `
                                <div class="queue-actions">

                                    <button type="button"
                                        class="accept-button"
                                        ${item.riderId && !isAssigned
                                            ? "disabled"
                                            : ""}
                                        onclick="acceptShipment('${safeTrackingNumber}')">
                                        ${isAssigned
                                            ? "✓ Accepted"
                                            : "Accept Shipment"}
                                    </button>

                                    <select
                                        class="shipment-status-select"
                                        aria-label="Update shipment status"
                                        id="${escapeHTML(selectId)}"
                                        ${!isAssigned ? "disabled" : ""}>

                                        ${statusSteps().map(status => `
                                            <option
                                                value="${escapeHTML(status)}"
                                                ${status === item.status
                                                    ? "selected"
                                                    : ""}>
                                                ${escapeHTML(status)}
                                            </option>
                                        `).join("")}
                                    </select>

                                    <button type="button"
                                        class="complete-button"
                                        ${!isAssigned ? "disabled" : ""}
                                        onclick="updateShipmentStatus(
                                            '${safeTrackingNumber}',
                                            '${escapeHTML(selectId)}'
                                        )">
                                        Update Status
                                    </button>

                                </div>
                            `}
                        </article>
                    `;
                }).join("")}
            </div>
        `;
    }

    // Render the dashboard once. This avoids the duplicate rendering
    // functions and duplicate list.innerHTML assignments in the old code.
    list.innerHTML = `
        ${modes}

        <section class="shipment-section">
            <div class="section-heading">
                <h2>Active Shipments</h2>
                <span class="gantt-count">
                    ${activePackages.length} shipment(s)
                </span>
            </div>

            <p class="muted">
                Arranged using ${descriptions[riderSchedulingMode]}.
            </p>

            ${renderShipmentCards(
                activePackages,
                false,
                "active"
            )}
        </section>

        <section class="shipment-section">
            <div class="section-heading">
                <h2>Completed Shipments</h2>
                <span class="gantt-count">
                    ${completedPackages.length} shipment(s)
                </span>
            </div>

            <p class="muted">
                Completed deliveries are shown separately from active shipments.
            </p>

            ${renderShipmentCards(
                completedPackages,
                true,
                "completed"
            )}
        </section>
    `;
}

function acceptShipment(trackingNumber) {
    if (!currentUser || currentUser.role !== "rider") return;

    const packages = getPackages();

    const item = packages.find(
        pkg => pkg.trackingNumber === trackingNumber
    );

    if (!item) {
        alert("Shipment not found.");
        return;
    }

    if (isCompletedShipment(item)) {
        alert("This shipment has already been completed.");
        return;
    }

    if (item.riderId && item.riderId !== currentUser.id) {
        alert("This shipment is already assigned to another rider.");
        return;
    }

    item.riderId = currentUser.id;
    item.riderName = currentUser.name;

    savePackages(packages);
    renderRiderDashboard();
}

function updateShipmentStatus(trackingNumber, selectId) {
    if (!currentUser || currentUser.role !== "rider") {
        alert("Only riders can update shipment status.");
        return;
    }

    const packages = getPackages();

    const item = packages.find(
        pkg => pkg.trackingNumber === trackingNumber
    );

    if (!item) {
        alert("Shipment not found.");
        return;
    }

    if (item.riderId !== currentUser.id) {
        alert("Accept this shipment before updating its status.");
        return;
    }

    if (isCompletedShipment(item)) {
        alert("This shipment is already completed.");
        return;
    }

    const status = byId(selectId)?.value;
    if (!status) return;

    item.status = status;
    item.statusUpdated = true;

    item.history = Array.isArray(item.history)
        ? item.history
        : [];

    item.history.push({
        status,
        at: new Date().toISOString(),
        note: `Status updated by ${currentUser.name}.`
    });

    savePackages(packages);
    renderApplication();
}

/* =====================================================
   PACKAGE TRACKING
===================================================== */

function showTracking() {
    hide("landingPage");
    hide("authPage");
    hide("customerPage");
    hide("riderPage");
    hide("successPage");

    show("trackingPage");
    renderNavigation();

    const query = byId("trackingInput")?.value.trim();

    if (query) trackPackage(query);
}

function trackFromForm(event) {
    event?.preventDefault();

    trackPackage(
        (byId("trackingInput")?.value || "").trim()
    );
}

function trackPackage(trackingNumber) {
    const query = String(trackingNumber || "")
        .trim().toUpperCase();

    hide("landingPage");
    hide("authPage");
    hide("customerPage");
    hide("riderPage");
    hide("successPage");

    show("trackingPage");
    renderNavigation();

    const result = byId("trackingResult");

    if (!query) {
        if (result) {
            result.innerHTML =
                '<p class="muted">Enter a tracking number to view shipment progress.</p>';
        }
        return;
    }

    if (byId("trackingInput")) {
        byId("trackingInput").value = query;
    }

    const item = getPackages().find(
        pkg => String(pkg.trackingNumber).toUpperCase() === query
    );

    if (!item) {
        if (result) {
            result.innerHTML = `
                <p class="message">
                    No shipment found for tracking number
                    <strong>${escapeHTML(query)}</strong>.
                </p>
            `;
        }
        return;
    }

    const steps = statusSteps();
    const statusIndex = steps.indexOf(item.status);
    const history = Array.isArray(item.history)
        ? item.history
        : [];

    if (!result) return;

    result.innerHTML = `
        <div class="card">
            <div class="tracking-header">
                <div>
                    <span class="eyebrow">TRACKING NUMBER</span>
                    <h2>${escapeHTML(item.trackingNumber)}</h2>
                    <p>${escapeHTML(item.description)}</p>
                </div>

                <span class="status">${escapeHTML(item.status)}</span>
            </div>

            <div class="timeline">
                ${steps.map((step, index) => {
                    const record = [...history].reverse().find(
                        entry => entry.status === step
                    );

                    const isReached =
                        statusIndex >= 0 && index <= statusIndex;

                    return `
                        <div class="timeline-step ${
                            isReached ? "completed" : ""
                        }">
                            <div class="timeline-dot">
                                ${isReached ? "✓" : index + 1}
                            </div>

                            <strong>${escapeHTML(step)}</strong>

                            <small>
                                ${record
                                    ? escapeHTML(formatDate(record.at))
                                    : "Pending"}
                            </small>
                        </div>
                    `;
                }).join("")}
            </div>

            <div class="tracking-details">
                <div>
                    <span>Sender</span>
                    <strong>${escapeHTML(item.senderName || "Not provided")}</strong>
                </div>

                <div>
                    <span>Sender contact</span>
                    <strong>${escapeHTML(item.senderPhone || "Not provided")}</strong>
                </div>

                <div>
                    <span>Recipient</span>
                    <strong>${escapeHTML(item.recipient)}</strong>
                </div>

                <div>
                    <span>Recipient contact</span>
                    <strong>${escapeHTML(item.recipientPhone || "Not provided")}</strong>
                </div>

                <div>
                    <span>Priority</span>
                    <strong>${escapeHTML(priorityLabel(item.priority))}</strong>
                </div>

                <div>
                    <span>Delivery address</span>
                    <strong>${escapeHTML(item.deliveryAddress)}</strong>
                </div>

                <div>
                    <span>Pickup address</span>
                    <strong>${escapeHTML(item.pickupAddress)}</strong>
                </div>

                <div>
                    <span>Assigned rider</span>
                    <strong>${escapeHTML(item.riderName || "Not assigned")}</strong>
                </div>
            </div>

            <h3>Shipment history</h3>

            ${history.length
                ? history.slice().reverse().map(entry => `
                    <p>
                        <strong>${escapeHTML(entry.status)}</strong>
                        <span class="muted">
                            — ${escapeHTML(formatDate(entry.at))}
                        </span>
                        <br>
                        ${escapeHTML(entry.note || "")}
                    </p>
                `).join("")
                : '<p class="muted">No status history yet.</p>'}
        </div>
    `;
}

function clearTracking() {
    if (byId("trackingInput")) {
        byId("trackingInput").value = "";
    }

    if (byId("trackingResult")) {
        byId("trackingResult").innerHTML = "";
    }
}

/* =====================================================
   GANTT CHARTS FOR COMPLETED SHIPMENTS
   One implementation only — no duplicate functions.
===================================================== */

function closeGanttCharts() {
    byId("ganttModal")?.remove();
    document.removeEventListener("keydown", handleGanttEscape);
}

function handleGanttEscape(event) {
    if (event.key === "Escape") {
        closeGanttCharts();
    }
}

function viewGanttCharts() {
    // Include both Delivered and Completed statuses.
    
const completed = getPackages().filter(item => {
    if (!isCompletedShipment(item)) return false;

    // Customers see only their own completed shipments.
    if (currentUser?.role === "customer") {
        return item.senderId === currentUser.id;
    }

    // Riders see only shipments assigned to them.
    if (currentUser?.role === "rider") {
        return item.riderId === currentUser.id;
    }

    return false;
});


    closeGanttCharts();

    const algorithms = [
        {
            mode: "FCFS",
            title: "FCFS",
            description: "Shipments run in the order they were created."
        },
        {
            mode: "SJF",
            title: "Non-preemptive SJF",
            description: "Shipments with the shortest estimated time run first."
        },
        {
            mode: "PRIORITY",
            title: "Priority Scheduling",
            description: "Express shipments run before Urgent and Normal shipments."
        }
    ];

    function calculateSchedule(mode) {
        const ordered = sortShipments(completed, mode);
        let elapsed = 0;

        const tasks = ordered.map((shipment, index) => {
            const duration = Math.max(
                1,
                Number(shipment.estimatedTravelTime) || 1
            );

            const process =
                shipment.trackingNumber ||
                shipment.id ||
                `Shipment ${index + 1}`;

            const task = {
                shipment,
                process,
                duration,
                start: elapsed,
                finish: elapsed + duration,
                waiting: elapsed,
                turnaround: elapsed + duration
            };

            elapsed += duration;
            return task;
        });

        const count = tasks.length;

        const totalWaiting = tasks.reduce(
            (sum, task) => sum + task.waiting,
            0
        );

        const totalTurnaround = tasks.reduce(
            (sum, task) => sum + task.turnaround,
            0
        );

        return {
            tasks,
            totalTime: elapsed,
            averageWaiting: count ? totalWaiting / count : 0,
            averageTurnaround: count ? totalTurnaround / count : 0
        };
    }

    const schedules = {};

    algorithms.forEach(algorithm => {
        schedules[algorithm.mode] =
            calculateSchedule(algorithm.mode);
    });

    const modal = document.createElement("div");

    modal.id = "ganttModal";
    modal.className = "gantt-modal";

    modal.innerHTML = `
        <div class="gantt-modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ganttModalTitle">

            <div class="gantt-modal-header">
                <div>
                    <span class="gantt-eyebrow">
                        QUICKSHIP PH · ANALYTICS
                    </span>

                    <h2 id="ganttModalTitle">
                        Scheduling Performance
                    </h2>

                    <p class="gantt-subtitle">
                        Compare scheduling algorithms for completed shipments.
                    </p>
                </div>

                <button type="button"
                    class="gantt-close-button"
                    data-gantt-close
                    aria-label="Close Gantt chart">
                    &times;
                </button>
            </div>

            <div class="gantt-tabs" role="tablist"
                aria-label="Scheduling algorithms">

                ${algorithms.map((algorithm, index) => `
                    <button type="button"
                        class="gantt-tab ${index === 0 ? "active" : ""}"
                        role="tab"
                        aria-selected="${index === 0}"
                        data-gantt-tab="${algorithm.mode}">
                        ${algorithm.title}
                    </button>
                `).join("")}
            </div>

            <div id="ganttActiveContent"></div>

            <div class="gantt-modal-footer">
                <span>Times are calculated in minutes.</span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    function renderActiveChart(mode) {
        const algorithm = algorithms.find(
            item => item.mode === mode
        );

        const schedule = schedules[mode];
        const tasks = schedule.tasks;
        const count = tasks.length;
        const total = schedule.totalTime;

        modal.querySelectorAll("[data-gantt-tab]")
            .forEach(tab => {
                const active = tab.dataset.ganttTab === mode;

                tab.classList.toggle("active", active);
                tab.setAttribute("aria-selected", String(active));
            });

        const content = byId("ganttActiveContent");

        if (!content) return;

        if (!count) {
            content.innerHTML = `
                <section class="gantt-panel">
                    <h3>${algorithm.title}</h3>

                    <div class="gantt-empty">
                        <div class="gantt-empty-icon">📦</div>

                        <strong>No completed shipments yet</strong>

                        <p>
                            Shipments marked Delivered or Completed
                            will appear in these charts.
                        </p>
                    </div>
                </section>
            `;
            return;
        }

        const tickInterval = 10;
        const ticks = [];

        for (let time = 0; time < total; time += tickInterval) {
            ticks.push(time);
        }

        if (ticks[ticks.length - 1] !== total) {
            ticks.push(total);
        }

        const chartBlocks = tasks.map((task, index) => {
            const width = task.duration / total * 100;
            const tracking = escapeHTML(task.process);

            return `
                <button type="button"
                    class="gantt-block ${index === 0 ? "first-block" : ""}"
                    style="width:${width}%;"
                    data-gantt-process="${tracking}"
                    title="${tracking} | ${task.start}–${task.finish} min">

                    <strong>${tracking}</strong>
                    <span>${task.duration}m</span>
                </button>
            `;
        }).join("");

        const timeAxis = ticks.map(time => `
            <span class="gantt-time-marker ${
                time === total ? "final-marker" : ""
            }" style="left:${time / total * 100}%">
                ${time}
            </span>
        `).join("");

        const tableRows = tasks.map(task => {
            const tracking = escapeHTML(task.process);
            const priority = priorityLabel(task.shipment.priority);
            const priorityClass = priority.toLowerCase();

            return `
                <tr data-gantt-row="${tracking}">
                    <td>
                        <span class="gantt-process-tag">
                            ${tracking}
                        </span>
                    </td>

                    <td class="gantt-tracking-cell">
                        ${tracking}
                    </td>

                    <td>
                        <span class="gantt-priority-tag priority-${escapeHTML(
                            priorityClass
                        )}">
                            ${escapeHTML(priority)}
                        </span>
                    </td>

                    <td>${task.duration} min</td>
                    <td>${task.waiting} min</td>
                    <td>${task.turnaround} min</td>
                </tr>
            `;
        }).join("");

        content.innerHTML = `
            <section class="gantt-panel">
                <div class="gantt-chart-heading">
                    <div>
                        <h3>${algorithm.title}</h3>
                        <p>${algorithm.description}</p>
                    </div>

                    <span class="gantt-count">
                        ${count} shipment${count === 1 ? "" : "s"}
                    </span>
                </div>

                <div class="gantt-chart-card">
                    <div class="gantt-chart-label">
                        <span>Process execution timeline</span>
                        <span>Click a block to view its details</span>
                    </div>

                    <div class="gantt-chart-scroll">
                        <div class="gantt-chart-inner">
                            <div class="gantt-timeline">
                                ${chartBlocks}
                            </div>

                            <div class="gantt-time-axis">
                                ${timeAxis}
                            </div>
                        </div>
                    </div>

                    <div class="gantt-timeline-legend">
                        <span class="gantt-legend-dot"></span>
                        Block width represents estimated travel time.
                    </div>
                </div>

                <div class="gantt-metrics">
                    <article class="gantt-metric-card">
                        <span>Average waiting time</span>
                        <strong>
                            ${schedule.averageWaiting.toFixed(2)}
                            <small>min</small>
                        </strong>
                        <p>Average time waiting before execution.</p>
                    </article>

                    <article class="gantt-metric-card">
                        <span>Average turnaround time</span>
                        <strong>
                            ${schedule.averageTurnaround.toFixed(2)}
                            <small>min</small>
                        </strong>
                        <p>Average time from minute zero until completion.</p>
                    </article>

                    <article class="gantt-metric-card">
                        <span>Total scheduled time</span>
                        <strong>${total} <small>min</small></strong>
                        <p>Total estimated time for all shipments.</p>
                    </article>
                </div>

                <div class="gantt-table-section">
                    <div class="gantt-table-heading">
                        <div>
                            <h3>Shipment scheduling table</h3>
                            <p>Select a row or block to highlight a shipment.</p>
                        </div>

                        <span class="gantt-table-badge">
                            Calculated results
                        </span>
                    </div>

                    <div class="gantt-table-scroll">
                        <table class="gantt-data-table">
                            <thead>
                                <tr>
                                    <th>Shipment number</th>
                                    <th>Tracking number</th>
                                    <th>Priority</th>
                                    <th>Travel time</th>
                                    <th>Waiting time</th>
                                    <th>Turnaround time</th>
                                </tr>
                            </thead>

                            <tbody>${tableRows}</tbody>

                            <tfoot>
                                <tr>
                                    <td colspan="4">Average</td>
                                    <td>${schedule.averageWaiting.toFixed(2)} min</td>
                                    <td>${schedule.averageTurnaround.toFixed(2)} min</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                <div class="gantt-formula-note">
                    <strong>How the results are calculated</strong>
                    <p>Waiting time = start time − arrival time.</p>
                    <p>Turnaround time = finish time − arrival time.</p>
                    <p>Average = total of the relevant times ÷ number of shipments.</p>
                    <p>For this comparison, all shipments are assumed to arrive at minute zero.</p>
                </div>
            </section>
        `;

        function selectProcess(process) {
            content.querySelectorAll("[data-gantt-process]")
                .forEach(block => {
                    block.classList.toggle(
                        "selected",
                        block.dataset.ganttProcess === process
                    );
                });

            content.querySelectorAll("[data-gantt-row]")
                .forEach(row => {
                    row.classList.toggle(
                        "selected",
                        row.dataset.ganttRow === process
                    );
                });

            const task = tasks.find(
                item => item.process === process
            );

            const label = content.querySelector(
                ".gantt-chart-label span:last-child"
            );

            if (task && label) {
                label.textContent =
                    `${task.process}: ${task.start}–${task.finish} min · ` +
                    `Waiting: ${task.waiting} min · ` +
                    `Turnaround: ${task.turnaround} min`;
            }
        }

        content.querySelectorAll("[data-gantt-process]")
            .forEach(block => {
                block.addEventListener("click", () => {
                    selectProcess(block.dataset.ganttProcess);
                });
            });

        content.querySelectorAll("[data-gantt-row]")
            .forEach(row => {
                row.addEventListener("click", () => {
                    selectProcess(row.dataset.ganttRow);
                });
            });
    }

    modal.querySelectorAll("[data-gantt-tab]")
        .forEach(tab => {
            tab.addEventListener("click", () => {
                renderActiveChart(tab.dataset.ganttTab);
            });
        });

    modal.querySelector("[data-gantt-close]")
        ?.addEventListener("click", closeGanttCharts);

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            closeGanttCharts();
        }
    });

    document.addEventListener("keydown", handleGanttEscape);

    renderActiveChart("FCFS");
}

/* =====================================================
   INITIALIZATION
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
    byId("loginForm")?.addEventListener("submit", login);
    byId("registerForm")?.addEventListener("submit", register);
    byId("shipmentForm")?.addEventListener("submit", createShipment);
    byId("trackingForm")?.addEventListener("submit", trackFromForm);

    if (currentUser) {
        const storedUser = getUsers().find(
            user => user.id === currentUser.id
        );

        if (storedUser) {
            currentUser = storedUser;
        } else {
            currentUser = null;
            localStorage.removeItem(SESSION_KEY);
        }
    }

    if (currentUser) {
        renderApplication();
    } else {
        showLandingPage();
    }
});
