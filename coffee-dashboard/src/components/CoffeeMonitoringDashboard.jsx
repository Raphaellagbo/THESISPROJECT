import React, { useState, useEffect, useRef } from "react";
import {
    AlertTriangle,
    Thermometer,
    Droplets,
    Scale,
    Flame,
    CheckCircle,
    Info,
    Settings,
    X,
    Activity,
    Lightbulb,
    Cloud,
    Wind,
    MapPin,
    CloudRain,
    Sun,
    CloudSun,
    Loader2,
    Bell,
    BellOff,
    BellRing,
    CalendarDays,
    Clock,
    TrendingDown
} from "lucide-react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from "recharts";

import { database } from "../firebase";
import { ref, onValue, set } from "firebase/database";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";
import { Button } from "./ui/button.jsx";
import mlModel from './coffee_model_weights.json';

// ==========================================================
// 1. SENSOR FUSION LOGIC
// ==========================================================
const getEffectiveReadings = (s1, s2) => {
    const s1Valid = s1 && s1.temp > 0;
    const s2Valid = s2 && s2.temp > 0;

    let finalTemp = 0;
    let finalHumi = 0;
    let status = "NORMAL";

    if (s1Valid && s2Valid) {
        if (Math.abs(s1.temp - s2.temp) > 3.0) {
            status = "DISCREPANCY";
        }
        finalTemp = (s1.temp + s2.temp) / 2;
        finalHumi = (s1.humi + s2.humi) / 2;
    } else if (s1Valid) {
        finalTemp = s1.temp;
        finalHumi = s1.humi;
        status = "SINGLE_FAILURE";
    } else if (s2Valid) {
        finalTemp = s2.temp;
        finalHumi = s2.humi;
        status = "SINGLE_FAILURE";
    } else {
        status = "OFFLINE";
    }

    return { finalTemp, finalHumi, status };
};

// ==========================================================
// 2. AI LOGIC
// ==========================================================
const analyzeCoffeeQuality = (stage, temp, humidity, weight, moisture, currentThresholds = null) => {

    if (stage === "Drying") {
        const rules = {
            threshold_temp_max: currentThresholds?.dry_max_temp ?? mlModel.drying.threshold_temp_max,
            threshold_humi_max: currentThresholds?.dry_max_humi ?? mlModel.drying.threshold_humi_max,
            threshold_moisture_ferment: mlModel.drying.threshold_moisture_ferment,
            threshold_optimal_target: currentThresholds?.dry_target_weight ?? mlModel.drying.threshold_optimal_target,
            threshold_over_dried: mlModel.drying.threshold_over_dried,
        };

        if (weight < 0.1) {
            return {
                message: "WAITING FOR BEANS... (Load Cell Empty)",
                action: "Place fresh coffee cherries on the drying tray to begin monitoring.",
                type: "neutral"
            };
        }

        if (moisture > 0 && moisture < rules.threshold_over_dried) {
            return {
                message: `CRITICAL: OVER-DRIED! (${moisture.toFixed(1)}% MC)`,
                action: "REMOVE BEANS IMMEDIATELY! Quality is degrading due to low moisture.",
                type: "critical"
            };
        }

        if (temp > rules.threshold_temp_max && moisture > rules.threshold_moisture_ferment) {
            return {
                message: "CRITICAL: FERMENTATION RISK (Hot & Wet)",
                action: "LOWER TEMPERATURE & INCREASE AIRFLOW! Stir beans to dissipate heat.",
                type: "critical"
            };
        }

        if (humidity > rules.threshold_humi_max) {
            return {
                message: `WARNING: TOO HUMID (${humidity.toFixed(1)}%)`,
                action: "Protect beans from moisture re-absorption. Cover or use dehumidifier.",
                type: "warning"
            };
        }

        if (moisture > 0 && moisture <= rules.threshold_optimal_target) {
            return {
                message: `OPTIMAL: DRYING COMPLETE (${moisture.toFixed(1)}% MC)`,
                action: "HARVEST NOW. Beans are ready for storage or roasting.",
                type: "success"
            };
        }

        return {
            message: `OPTIMAL: DRYING IN PROGRESS (${moisture.toFixed(1)}% MC)`,
            action: "Maintain current conditions. Monitor periodically.",
            type: "info"
        };
    }

    else if (stage === "Roasting") {
        const rules = {
            threshold_burnt: mlModel.roasting.threshold_burnt,
            threshold_optimal_min: currentThresholds?.roast_min_temp ?? mlModel.roasting.threshold_optimal_min,
            threshold_optimal_max: currentThresholds?.roast_max_temp ?? mlModel.roasting.threshold_optimal_max,
        };

        if (temp >= rules.threshold_burnt) {
            return {
                message: `CRITICAL: BURNT / OVER-ROASTED (${temp}°C)`,
                action: "EMERGENCY STOP! Turn off heat and dump beans to cooling tray.",
                type: "critical"
            };
        }
        if (temp >= rules.threshold_optimal_min && temp <= rules.threshold_optimal_max) {
            return {
                message: "OPTIMAL: TARGET ROAST LEVEL ACHIEVED",
                action: "Prepare to drop beans. Monitor color for desired roast (Medium/Dark).",
                type: "success"
            };
        }
        if (temp < rules.threshold_optimal_min) {
            return {
                message: "INFO: ROASTING IN PROGRESS (Developing)",
                action: "Monitor Rate of Rise (RoR). Listen for First Crack.",
                type: "info"
            };
        }
    }

    return { message: "WAITING FOR DATA...", action: "Check sensor connections.", type: "neutral" };
};

// ==========================================================
// 3. DISPLAY HELPER
// ==========================================================
const formatWeight = (weightInKg) => {
    if (weightInKg < 1.0) return `${(weightInKg * 1000).toFixed(0)} g`;
    return `${weightInKg.toFixed(2)} kg`;
};

// Helper to calculate estimated completion time
const estimateCompletionTime = (historyData, targetMoisture) => {
    if (!historyData || historyData.length < 10) return null; // Need enough data points

    // Get recent data window (last 60 points or all if less)
    const window = historyData.slice(-60);
    const first = window[0];
    const last = window[window.length - 1];

    if (!first || !last) return null;

    const timeElapsedHours = (new Date(last.timestamp) - new Date(first.timestamp)) / 3600000;
    const moistureChange = first.moisture - last.moisture;

    // If moisture isn't dropping or time is 0, can't predict
    if (timeElapsedHours <= 0.05 || moistureChange <= 0) return null;

    const ratePerHour = moistureChange / timeElapsedHours;
    const remainingMoisture = last.moisture - targetMoisture;

    if (remainingMoisture <= 0) return "Ready Now";

    const hoursLeft = remainingMoisture / ratePerHour;

    if (hoursLeft > 240) return "> 10 Days"; // Outlier

    const now = new Date();
    const completionDate = new Date(now.getTime() + hoursLeft * 3600000);

    // If less than 24 hours, show hours, otherwise show date
    if (hoursLeft < 24) {
        return `${hoursLeft.toFixed(1)} hrs`;
    } else {
        return `${(hoursLeft / 24).toFixed(1)} days`;
    }
};

export default function CoffeeMonitoringDashboard() {
    const [stage, setStage] = useState("Drying");
    const [showSettings, setShowSettings] = useState(false);

    // --- THRESHOLDS ---
    const [thresholds, setThresholds] = useState({
        dry_max_temp: 40.0,
        dry_max_humi: 65.0,
        dry_target_weight: 12.0, // This is actually Target Moisture % in the logic
        roast_max_temp: 224.0,
        roast_min_temp: 196.0
    });

    const handleThresholdChange = (e) => {
        const { name, value } = e.target;
        setThresholds(prev => ({ ...prev, [name]: parseFloat(value) }));
    };

    // --- SENSOR STATE ---
    const [liveData, setLiveData] = useState({
        sensorLeft: { temp: 0, humi: 0 },
        sensorRight: { temp: 0, humi: 0 },
        roaster: { temp: 0 },
        drying: { weight: 0, moisture: 0 }
    });

    const [dryingGraphData, setDryingGraphData] = useState([]);
    const [roastingGraphData, setRoastingGraphData] = useState([]);
    const [dryingEstimation, setDryingEstimation] = useState(null);

    // --- WEATHER STATE ---
    const [showWeather, setShowWeather] = useState(false);
    const [weatherData, setWeatherData] = useState(null);
    const [dailyForecast, setDailyForecast] = useState(null); // Added for rain prediction
    const [weatherLoading, setWeatherLoading] = useState(false);
    const [weatherError, setWeatherError] = useState(null);
    const [selectedLocation, setSelectedLocation] = useState(() => {
        try {
            const saved = localStorage.getItem('coffee_selected_location');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    });

    // --- NOTIFICATION & AUTO-REFRESH STATE ---
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [notifPermission, setNotifPermission] = useState(
        typeof Notification !== "undefined" ? Notification.permission : "default"
    );
    const [toasts, setToasts] = useState([]);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [lastCheckedWeather, setLastCheckedWeather] = useState(null);
    const weatherRefreshRef = useRef(null);
    const prevAiAlertRef = useRef({ message: "", type: "" });

    // --- SETTINGS LOADED FLAG ---
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // --- PWA UPDATE BANNER STATE ---
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const pendingWorkerRef = useRef(null);

    // ==========================================================
    // PWA UPDATE LOGIC
    // ==========================================================
    useEffect(() => {
        const handleUpdateAvailable = (e) => {
            pendingWorkerRef.current = e.detail?.newWorker ?? null;
            setUpdateAvailable(true);
        };
        window.addEventListener('pwa-update-available', handleUpdateAvailable);
        return () => window.removeEventListener('pwa-update-available', handleUpdateAvailable);
    }, []);

    const applyUpdate = () => {
        if (pendingWorkerRef.current) {
            pendingWorkerRef.current.postMessage({ type: 'SKIP_WAITING' });
        }
        navigator.serviceWorker?.addEventListener('controllerchange', () => {
            window.location.reload();
        }, { once: true });
        setTimeout(() => window.location.reload(), 1000);
    };

    // ==========================================================
    // FIREBASE SETTINGS
    // ==========================================================
    useEffect(() => {
        const settingsRef = ref(database, '/settings');
        const unsubscribe = onValue(settingsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setNotificationsEnabled(data.notificationsEnabled ?? false);
                setShowWeather(data.showWeather ?? false);
                setAutoRefresh(data.autoRefresh ?? false);
            }
            setSettingsLoaded(true);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!settingsLoaded) return;
        set(ref(database, '/settings/notificationsEnabled'), notificationsEnabled);
    }, [notificationsEnabled, settingsLoaded]);

    useEffect(() => {
        if (!settingsLoaded) return;
        set(ref(database, '/settings/showWeather'), showWeather);
    }, [showWeather, settingsLoaded]);

    useEffect(() => {
        if (!settingsLoaded) return;
        set(ref(database, '/settings/autoRefresh'), autoRefresh);
    }, [autoRefresh, settingsLoaded]);

    // ==========================================================
    // LOCATIONS
    // ==========================================================
    const PH_LOCATIONS = [
        { name: "Amadeo, Cavite", lat: 14.1736, lon: 120.9189 },
        { name: "Imus, Cavite", lat: 14.4297, lon: 120.9367 },
        { name: "Kawit, Cavite", lat: 14.4352, lon: 120.8994 },
        { name: "Tagaytay City", lat: 14.1153, lon: 120.9621 },
        { name: "Lipa City, Batangas", lat: 13.9411, lon: 121.1631 },
        { name: "Benguet (La Trinidad)", lat: 16.4623, lon: 120.5877 },
        { name: "Sagada, Mountain Province", lat: 17.0847, lon: 120.9001 },
        { name: "Davao City", lat: 7.1907, lon: 125.4553 },
        { name: "Mount Apo, Davao", lat: 6.9876, lon: 125.2707 },
        { name: "Bukidnon (Malaybalay)", lat: 8.1575, lon: 125.1278 },
        { name: "Cordillera (Baguio)", lat: 16.4023, lon: 120.5960 },
        { name: "Cebu City", lat: 10.3157, lon: 123.8854 },
    ];

    // ==========================================================
    // WEATHER & PREDICTION FETCH
    // ==========================================================
    const fetchWeather = async (location) => {
        setWeatherLoading(true);
        setWeatherError(null);
        setWeatherData(null);
        setDailyForecast(null);
        setSelectedLocation(location);
        try { localStorage.setItem('coffee_selected_location', JSON.stringify(location)); } catch { }
        try {
            // UPDATED URL: Added daily parameters for rain prediction and 7-day forecast
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&hourly=temperature_2m,relative_humidity_2m&daily=weather_code,precipitation_sum,precipitation_probability_max&timezone=Asia%2FManila&forecast_days=7`;

            const res = await fetch(url);
            if (!res.ok) throw new Error("Failed to fetch weather");
            const json = await res.json();

            setWeatherData(json);
            setDailyForecast(json.daily); // Store daily forecast data

            evaluateWeatherAlerts(json, location);
        } catch (err) {
            setWeatherError("Could not load weather data. Check your connection.");
        } finally {
            setWeatherLoading(false);
        }
    };

    useEffect(() => {
        if (selectedLocation) {
            fetchWeather(selectedLocation);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getWeatherIcon = (code) => {
        if (code === 0) return <Sun size={32} className="text-yellow-400" />;
        if (code <= 3) return <CloudSun size={32} className="text-yellow-300" />;
        if (code <= 67) return <CloudRain size={32} className="text-blue-400" />;
        return <Cloud size={32} className="text-gray-400" />;
    };

    const getWeatherLabel = (code) => {
        if (code === 0) return "Clear Sky";
        if (code <= 3) return "Partly Cloudy";
        if (code <= 48) return "Foggy / Overcast";
        if (code <= 67) return "Rainy";
        if (code <= 77) return "Snow / Sleet";
        if (code <= 99) return "Thunderstorm";
        return "Unknown";
    };

    const getDryingImpact = (humidity, temp) => {
        if (humidity > 75) return { label: "Poor Drying Conditions", color: "text-red-600", note: "High ambient humidity will slow moisture loss and raise mold risk." };
        if (humidity > 65) return { label: "Moderate Conditions", color: "text-orange-500", note: "Monitor closely. Consider cover drying to protect against re-absorption." };
        if (temp > 35) return { label: "Heat Caution", color: "text-orange-500", note: "High outdoor temp may raise drying station temp above 40°C threshold." };
        return { label: "Favorable for Drying", color: "text-green-600", note: "Ambient conditions support optimal drying. Proceed normally." };
    };

    // --- TOAST HELPERS ---
    const addToast = (message, type = "info") => {
        const id = Date.now();
        setToasts(prev => [...prev.slice(-4), { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
    };
    const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

    const requestNotifPermission = async () => {
        if (typeof Notification === "undefined") {
            addToast("Browser notifications not supported.", "warning");
            return;
        }
        const perm = await Notification.requestPermission();
        setNotifPermission(perm);
        if (perm === "granted") {
            setNotificationsEnabled(true);
            addToast("All system notifications enabled!", "success");
        } else {
            addToast("Notification permission denied.", "warning");
        }
    };

    const toggleNotifications = () => {
        if (!notificationsEnabled) {
            if (notifPermission === "granted") {
                setNotificationsEnabled(true);
                addToast("All system notifications enabled!", "success");
            } else {
                requestNotifPermission();
            }
        } else {
            setNotificationsEnabled(false);
            prevAiAlertRef.current = { message: "", type: "" };
            addToast("All system notifications disabled.", "info");
        }
    };

    const sendWeatherAlert = (title, body, type = "warning") => {
        addToast(`${title}: ${body}`, type);
        if (notificationsEnabled && notifPermission === "granted") {
            try { new Notification(title, { body, tag: "coffee-weather-alert" }); } catch (e) { }
        }
    };

    const sendSensorAlert = (title, body, type = "warning", tag = "coffee-sensor-alert") => {
        addToast(`${title}: ${body}`, type);
        if (notificationsEnabled && notifPermission === "granted") {
            try { new Notification(title, { body, tag }); } catch (e) { }
        }
    };

    const evaluateWeatherAlerts = (json, location) => {
        const c = json.current;
        const humidity = c.relative_humidity_2m;
        const temp = c.temperature_2m;
        const precip = c.precipitation;
        const code = c.weather_code;
        const alerts = [];
        if (humidity > 75) alerts.push({ title: "⚠️ High Humidity Alert", body: `${location.name}: ${humidity}% RH — Mold risk elevated. Protect drying beans.`, type: "critical" });
        else if (humidity > 65) alerts.push({ title: "🌫️ Humidity Warning", body: `${location.name}: ${humidity}% RH — Above safe 65% threshold. Monitor closely.`, type: "warning" });
        if (temp > 35) alerts.push({ title: "🌡️ Heat Warning", body: `${location.name}: ${temp}°C outdoor — May push drying station above 40°C limit.`, type: "warning" });
        if (precip > 0) alerts.push({ title: "🌧️ Rain Detected", body: `${location.name}: ${precip}mm rain — Move beans indoors or cover immediately.`, type: "critical" });
        if (code >= 80) alerts.push({ title: "⛈️ Storm Warning", body: `${location.name}: Severe weather — Do not begin a new drying cycle.`, type: "critical" });
        alerts.forEach(a => sendWeatherAlert(a.title, a.body, a.type));
        if (alerts.length === 0) addToast(`${location.name}: Conditions favorable for drying.`, "success");
        setLastCheckedWeather(new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }));
    };

    useEffect(() => {
        if (autoRefresh && selectedLocation) {
            weatherRefreshRef.current = setInterval(() => {
                fetchWeather(selectedLocation); // Reuse fetchWeather to get latest data
            }, 10 * 60 * 1000);
        }
        return () => clearInterval(weatherRefreshRef.current);
    }, [autoRefresh, selectedLocation, notificationsEnabled]);

    // ==========================================================
    // FIREBASE SENSOR DATA LISTENER & DRYING PREDICTION
    // ==========================================================
    useEffect(() => {
        const sensorsRef = ref(database, '/');
        const unsubscribe = onValue(sensorsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                let sLeftTemp = 0, sLeftHumi = 0;
                let sRightTemp = 0, sRightHumi = 0;
                let roastTemp = 0;
                let dryWeight = 0;
                let dryMoisture = 0;

                if (data.drying) {
                    if (data.drying.temp_left) sLeftTemp = data.drying.temp_left;
                    if (data.drying.humi_left) sLeftHumi = data.drying.humi_left;
                    if (data.drying.temp_right) sRightTemp = data.drying.temp_right;
                    if (data.drying.humi_right) sRightHumi = data.drying.humi_right;
                    if (data.drying.weight) dryWeight = data.drying.weight;
                    if (data.drying.current_moisture) dryMoisture = data.drying.current_moisture;
                }

                if (data.roaster) {
                    if (data.roaster.temperature) roastTemp = data.roaster.temperature;
                }

                setLiveData({
                    sensorLeft: { temp: sLeftTemp, humi: sLeftHumi },
                    sensorRight: { temp: sRightTemp, humi: sRightHumi },
                    roaster: { temp: roastTemp },
                    drying: { weight: dryWeight, moisture: dryMoisture }
                });

                const timestamp = new Date().toISOString();

                // UPDATED: Added 'moisture' to graph data history for prediction
                setDryingGraphData(prev => {
                    const newData = [...prev, { timestamp, weight: dryWeight, moisture: dryMoisture, humidity: sLeftHumi, temperature: sLeftTemp }];
                    // Keep larger buffer (100 points) for better trend calculation
                    const trimmed = newData.slice(-100);

                    // Run Estimation
                    const est = estimateCompletionTime(trimmed, thresholds.dry_target_weight);
                    setDryingEstimation(est);

                    return trimmed;
                });

                if (roastTemp > 0) {
                    setRoastingGraphData(prev => [...prev, { timestamp, temperature: roastTemp }].slice(-20));
                }

                setStage(currentStage => {
                    setThresholds(currentThresholds => {
                        let aiResult;
                        if (currentStage === "Roasting") {
                            aiResult = analyzeCoffeeQuality(currentStage, roastTemp, 0, 0, 0, currentThresholds);
                        } else {
                            const s1 = { temp: sLeftTemp, humi: sLeftHumi };
                            const s2 = { temp: sRightTemp, humi: sRightHumi };
                            const { finalTemp, finalHumi, status } = getEffectiveReadings(s1, s2);
                            aiResult = analyzeCoffeeQuality(currentStage, finalTemp, finalHumi, dryWeight, dryMoisture, currentThresholds);

                            if (status === "DISCREPANCY" && prevAiAlertRef.current.message !== "DISCREPANCY") {
                                sendSensorAlert("⚠️ Sensor Mismatch", "Left/Right sensors differ >3°C. Readings averaged. Check sensor placement.", "warning", "sensor-discrepancy");
                                prevAiAlertRef.current = { message: "DISCREPANCY", type: "warning" };
                            }
                            if (status === "SINGLE_FAILURE" && prevAiAlertRef.current.message !== "SINGLE_FAILURE") {
                                sendSensorAlert("🔌 Sensor Failure", "One DHT22 sensor is offline. Redundancy mode active.", "warning", "sensor-failure");
                                prevAiAlertRef.current = { message: "SINGLE_FAILURE", type: "warning" };
                            }
                        }

                        const prev = prevAiAlertRef.current;
                        if (aiResult.message !== prev.message && aiResult.type !== "neutral") {
                            const notifMap = {
                                critical: { title: "🚨 CRITICAL Alert", tag: "ai-critical" },
                                warning: { title: "⚠️ Warning", tag: "ai-warning" },
                                success: { title: "✅ Status Update", tag: "ai-success" },
                                info: { title: "ℹ️ Info", tag: "ai-info" },
                            };
                            const n = notifMap[aiResult.type] ?? notifMap.info;
                            sendSensorAlert(n.title, aiResult.message + " — " + aiResult.action, aiResult.type, n.tag);
                            prevAiAlertRef.current = { message: aiResult.message, type: aiResult.type };
                        }

                        return currentThresholds;
                    });
                    return currentStage;
                });
            }
        });
        return () => unsubscribe();
    }, [notificationsEnabled, notifPermission, thresholds.dry_target_weight]); // Added thresholds dependency

    const formatTimeLabel = (iso) => {
        try {
            const d = new Date(iso);
            return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
        } catch (e) { return ""; }
    };

    // --- SENSOR STATUS ALERT COMPONENT ---
    const SensorStatusAlert = ({ s1Data, s2Data, roastData, weightValue, moistureValue, currentStage, currentThresholds, outdoorWeather }) => {

        let aiResult = { message: "Loading...", action: "Wait...", type: "neutral" };
        let displayTemp = 0;
        let displayHumi = 0;
        let status = "NORMAL";

        if (currentStage === "Roasting") {
            aiResult = analyzeCoffeeQuality(currentStage, roastData.temp, 0, 0, 0, currentThresholds);
            displayTemp = roastData.temp;
        } else {
            const readings = getEffectiveReadings(s1Data, s2Data);
            displayTemp = readings.finalTemp;
            displayHumi = readings.finalHumi;
            status = readings.status;
            aiResult = analyzeCoffeeQuality(currentStage, displayTemp, displayHumi, weightValue, moistureValue, currentThresholds);
        }

        const weatherRisks = [];
        if (outdoorWeather && currentStage === "Drying") {
            const c = outdoorWeather.current;
            const outHumi = c.relative_humidity_2m;
            const outTemp = c.temperature_2m;
            const precip = c.precipitation;
            const code = c.weather_code;

            if (outHumi > 75) {
                weatherRisks.push({ level: "critical", text: `Outdoor humidity critically high (${outHumi}% RH) — ambient air will re-absorb moisture into beans, compounding fermentation risk.` });
            } else if (outHumi > 65) {
                weatherRisks.push({ level: "warning", text: `Outdoor humidity elevated (${outHumi}% RH) — above the 65% mold-inhibition threshold. Consider covered drying.` });
            }
            if (outTemp > 35) {
                weatherRisks.push({ level: "warning", text: `Outdoor temp ${outTemp}°C — heat transfer may elevate drying station temp toward the 40°C over-fermentation limit.` });
            }
            if (precip > 0) {
                weatherRisks.push({ level: "critical", text: `Active precipitation (${precip}mm) detected — immediate risk of moisture re-absorption and surface contamination.` });
            }
            if (code >= 80) {
                weatherRisks.push({ level: "critical", text: `Severe weather event in progress — suspend outdoor drying immediately.` });
            }
            if (outHumi > 65 && displayHumi > (currentThresholds?.dry_max_humi ?? 65) && aiResult.type !== "critical") {
                aiResult = {
                    ...aiResult,
                    message: "⚠️ COMPOUNDED RISK: Indoor + Outdoor Humidity Both Elevated",
                    action: "URGENT: Both ambient and station humidity are above threshold. Cease drying, move beans to shelter, and run dehumidifier.",
                    type: "critical"
                };
            }
        }

        let colorClass = "bg-gray-100 text-gray-900 border-gray-200";
        let Icon = Info;

        switch (aiResult.type) {
            case "critical":
                colorClass = "bg-red-100 text-red-900 border-red-300";
                Icon = AlertTriangle;
                break;
            case "warning":
                colorClass = "bg-orange-100 text-orange-900 border-orange-300";
                Icon = AlertTriangle;
                break;
            case "success":
                colorClass = "bg-green-100 text-green-900 border-green-300";
                Icon = CheckCircle;
                break;
            case "info":
                colorClass = "bg-blue-100 text-blue-900 border-blue-300";
                Icon = Info;
                break;
            default:
                colorClass = "bg-gray-100 text-gray-800 border-gray-300";
        }

        return (
            <div className="space-y-3 sm:space-y-4">
                {status === "DISCREPANCY" && (
                    <div className="p-2 sm:p-3 bg-yellow-100 text-yellow-800 text-xs sm:text-sm rounded border border-yellow-200 flex items-start sm:items-center gap-2">
                        <Activity size={14} className="shrink-0 mt-0.5 sm:mt-0" /> <span><b>Sensor Mismatch:</b> Left/Right sensors differ {'>'} 3°. Using average.</span>
                    </div>
                )}
                {status === "SINGLE_FAILURE" && (
                    <div className="p-2 sm:p-3 bg-orange-100 text-orange-800 text-xs sm:text-sm rounded border border-orange-200 flex items-start sm:items-center gap-2">
                        <Activity size={14} className="shrink-0 mt-0.5 sm:mt-0" /> <span><b>Redundancy Active:</b> One sensor offline. Backup sensor in use.</span>
                    </div>
                )}

                <div className={`p-3 sm:p-4 rounded-lg border-2 shadow-sm ${colorClass}`}>
                    <div className="flex items-center gap-2 font-bold text-base sm:text-lg mb-2 sm:mb-1">
                        <Icon size={20} className="shrink-0" /> <span>AI Decision Engine</span>
                    </div>

                    <div className="text-xs sm:text-sm opacity-90 mb-3 pl-4 sm:pl-8 break-words">
                        {currentStage === "Roasting" ? (
                            <span>Current Temp: <b>{displayTemp}°C</b></span>
                        ) : (
                            <div className="space-y-1">
                                <div>Avg Temp: <b>{displayTemp.toFixed(1)}°C</b> | Avg Humi: <b>{displayHumi.toFixed(1)}%</b></div>
                                {weightValue > 0 && <div>Wt: <b>{formatWeight(weightValue)}</b> | Moisture: <b>{moistureValue?.toFixed(1)}%</b></div>}
                            </div>
                        )}
                    </div>

                    <div className="text-sm sm:text-base font-bold pl-4 sm:pl-8 break-words">
                        {aiResult.message}
                    </div>

                    <div className="mt-3 pt-3 border-t border-black/10 flex items-start gap-2 sm:gap-3 pl-1">
                        <div className="bg-white/50 p-1 sm:p-1.5 rounded-full shrink-0"><Lightbulb size={16} className="sm:w-[18px] sm:h-[18px]" /></div>
                        <div className="min-w-0">
                            <span className="text-xs font-bold uppercase tracking-wide opacity-70">Recommended Action</span>
                            <div className="text-xs sm:text-sm font-semibold break-words">{aiResult.action}</div>
                        </div>
                    </div>
                </div>

                {weatherRisks.length > 0 && (
                    <div className="rounded-lg border-2 border-sky-300 bg-sky-50 overflow-hidden">
                        <div className="px-3 sm:px-4 py-2 bg-sky-600 text-white flex items-center gap-1 sm:gap-2 flex-wrap">
                            <Cloud size={14} className="shrink-0" />
                            <span className="text-xs sm:text-sm font-bold uppercase tracking-wide">Outdoor Weather Risk Factors</span>
                            <span className="text-xs opacity-75">({selectedLocation?.name ?? "No location"})</span>
                        </div>
                        <div className="divide-y divide-sky-200">
                            {weatherRisks.map((risk, i) => (
                                <div key={i} className={`px-3 sm:px-4 py-2 sm:py-2.5 flex items-start gap-2 sm:gap-3 text-xs sm:text-sm
                                    ${risk.level === "critical" ? "bg-red-50 text-red-800" : "bg-orange-50 text-orange-800"}`}>
                                    <AlertTriangle size={13} className="mt-0.5 shrink-0 sm:w-[15px] sm:h-[15px]" />
                                    <span className="break-words">{risk.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!outdoorWeather && currentStage === "Drying" && (
                    <div className="text-xs text-gray-400 flex items-start gap-2 pl-1 pt-1">
                        <Cloud size={12} className="mt-0.5 shrink-0" /> <span className="break-words">No outdoor weather data loaded — open Weather panel and select a location to factor ambient conditions into this analysis.</span>
                    </div>
                )}

                {outdoorWeather && weatherRisks.length === 0 && currentStage === "Drying" && (
                    <div className="text-xs text-green-600 flex items-start gap-2 pl-1 pt-1 font-medium">
                        <CheckCircle size={12} className="mt-0.5 shrink-0" /> <span className="break-words">Outdoor conditions ({selectedLocation?.name}) are within safe limits — no additional weather risk.</span>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 p-4 sm:p-6 md:p-8">

            {/* TOAST NOTIFICATIONS */}
            <div className="fixed top-2 left-2 right-2 sm:top-4 sm:right-4 sm:left-auto z-50 flex flex-col gap-2 w-auto sm:w-80">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={`flex items-start gap-3 p-3 rounded-lg shadow-lg border text-xs sm:text-sm font-medium animate-pulse-once transition-all
                            ${toast.type === "critical" ? "bg-red-100 border-red-400 text-red-800" :
                                toast.type === "warning" ? "bg-orange-100 border-orange-400 text-orange-800" :
                                    toast.type === "success" ? "bg-green-100 border-green-400 text-green-800" :
                                        "bg-blue-100 border-blue-300 text-blue-800"}`}
                    >
                        <span className="flex-1">{toast.message}</span>
                        <button onClick={() => dismissToast(toast.id)} className="opacity-60 hover:opacity-100 shrink-0"><X size={14} /></button>
                    </div>
                ))}
            </div>

            {/* PWA UPDATE BANNER */}
            {updateAvailable && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
                    <div className="flex items-center gap-3 bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 border border-white/10">
                        <span className="text-xl select-none">🆕</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold leading-tight">Update available</p>
                            <p className="text-xs text-gray-400 leading-tight">A new version is ready to install</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={applyUpdate}
                                className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                            >
                                Refresh
                            </button>
                            <button
                                onClick={() => setUpdateAvailable(false)}
                                className="text-gray-400 hover:text-white transition-colors p-1"
                                title="Dismiss"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* HEADER */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">IoT & ML Coffee Quality Control</h1>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        onClick={toggleNotifications}
                        className={`flex items-center gap-2 border shadow-sm transition-colors ${notificationsEnabled ? "bg-amber-100 border-amber-400 text-amber-700 hover:bg-amber-200" : "bg-white hover:bg-gray-50 text-gray-600"}`}
                        variant="outline"
                        title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
                    >
                        {notificationsEnabled ? <BellRing size={18} className="text-amber-500" /> : <BellOff size={18} />}
                        <span className="hidden sm:inline">{notificationsEnabled ? "Alerts On" : "Alerts Off"}</span>
                    </Button>
                    <Button
                        onClick={() => setShowWeather(!showWeather)}
                        className={`flex items-center gap-2 border shadow-sm transition-colors ${showWeather ? "bg-sky-100 border-sky-400 text-sky-700 hover:bg-sky-200" : "bg-white hover:bg-gray-50"}`}
                        variant="outline"
                        title="Outdoor Weather Tracker"
                    >
                        <Cloud size={18} className={showWeather ? "text-sky-500" : ""} />
                        <span className="hidden sm:inline">Weather</span>
                    </Button>
                    <Button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 border shadow-sm bg-white hover:bg-gray-50" variant="outline">
                        <Settings size={18} /> {showSettings ? "Close Settings" : "Settings"}
                    </Button>
                </div>
            </div>

            {/* SETTINGS PANEL */}
            {showSettings && (
                <Card className="mb-6 border-2 border-blue-300 shadow-lg">
                    <CardHeader className="bg-blue-50">
                        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2"><Settings size={20} /> Threshold Configuration</div>
                            <Button onClick={() => setShowSettings(false)} variant="ghost" size="sm"><X size={18} /></Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                        <div className="space-y-3">
                            <h3 className="font-semibold text-gray-700 border-b pb-2 text-sm sm:text-base">Drying Process</h3>
                            <div><label className="text-xs sm:text-sm text-gray-600">Max Temp (°C) — Max 40°C to prevent cell damage</label><input type="number" name="dry_max_temp" step="0.5" value={thresholds.dry_max_temp} onChange={handleThresholdChange} className="w-full border rounded px-3 py-2 mt-1 text-sm" /></div>
                            <div><label className="text-xs sm:text-sm text-gray-600">Max Humi (%) — Below 65% to inhibit mold</label><input type="number" name="dry_max_humi" step="0.5" value={thresholds.dry_max_humi} onChange={handleThresholdChange} className="w-full border rounded px-3 py-2 mt-1 text-sm" /></div>
                            <div><label className="text-xs sm:text-sm text-gray-600">Target Moisture (%)</label><input type="number" name="dry_target_weight" step="0.5" value={thresholds.dry_target_weight} onChange={handleThresholdChange} className="w-full border rounded px-3 py-2 mt-1 text-sm" /></div>
                        </div>
                        <div className="space-y-3">
                            <h3 className="font-semibold text-gray-700 border-b pb-2 text-sm sm:text-base">Roasting Process</h3>
                            <div><label className="text-xs sm:text-sm text-gray-600">Min Temp (°C)</label><input type="number" name="roast_min_temp" step="5" value={thresholds.roast_min_temp} onChange={handleThresholdChange} className="w-full border rounded px-3 py-2 mt-1 text-sm" /></div>
                            <div><label className="text-xs sm:text-sm text-gray-600">Max Temp (°C)</label><input type="number" name="roast_max_temp" step="5" value={thresholds.roast_max_temp} onChange={handleThresholdChange} className="w-full border rounded px-3 py-2 mt-1 text-sm" /></div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* WEATHER PANEL */}
            {showWeather && (
                <Card className="mb-6 border-2 border-sky-300 shadow-lg overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-sky-500 to-blue-600 text-white py-3 sm:py-4">
                        <CardTitle className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Cloud size={20} />
                                <span>Outdoor Weather Tracker</span>
                                <span className="text-xs font-normal bg-white/20 px-2 py-0.5 rounded-full">via Open-Meteo</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {lastCheckedWeather && (
                                    <span className="text-xs opacity-70">Last: {lastCheckedWeather}</span>
                                )}
                                <button
                                    onClick={() => {
                                        setAutoRefresh(prev => {
                                            const next = !prev;
                                            addToast(next ? "Auto-refresh ON (every 10 min)" : "Auto-refresh OFF", next ? "success" : "info");
                                            return next;
                                        });
                                    }}
                                    className={`text-xs px-2 py-1 rounded-full border font-medium transition-all flex items-center gap-1 ${autoRefresh ? "bg-white text-sky-700 border-white" : "bg-white/20 text-white border-white/40 hover:bg-white/30"}`}
                                    title="Toggle auto-refresh every 10 minutes"
                                >
                                    <Bell size={12} /> {autoRefresh ? "Auto ON" : "Auto OFF"}
                                </button>
                                <Button onClick={() => setShowWeather(false)} variant="ghost" size="sm" className="text-white hover:bg-white/20 h-8 w-8 p-0">
                                    <X size={18} />
                                </Button>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5 pb-5 bg-sky-50">
                        <div className="mb-5">
                            <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                <MapPin size={13} /> Select a location to check ambient conditions
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {PH_LOCATIONS.map((loc) => (
                                    <button
                                        key={loc.name}
                                        onClick={() => fetchWeather(loc)}
                                        className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${selectedLocation?.name === loc.name
                                            ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                                            : "bg-white text-sky-700 border-sky-300 hover:bg-sky-100 hover:border-sky-400"
                                            }`}
                                    >
                                        {loc.name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {weatherLoading && (
                            <div className="flex items-center justify-center gap-3 py-8 text-sky-600">
                                <Loader2 size={22} className="animate-spin" />
                                <span className="text-sm font-medium">Fetching weather data...</span>
                            </div>
                        )}

                        {weatherError && (
                            <div className="p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm flex items-center gap-2">
                                <AlertTriangle size={16} /> {weatherError}
                            </div>
                        )}

                        {weatherData && !weatherLoading && (() => {
                            const c = weatherData.current;
                            const temp = c.temperature_2m;
                            const humidity = c.relative_humidity_2m;
                            const wind = c.wind_speed_10m;
                            const precip = c.precipitation;
                            const code = c.weather_code;
                            const impact = getDryingImpact(humidity, temp);

                            return (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        <div className="sm:col-span-1 bg-gradient-to-br from-sky-400 to-blue-500 text-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow">
                                            {getWeatherIcon(code)}
                                            <p className="text-3xl font-bold mt-2">{temp}°C</p>
                                            <p className="text-sm font-medium opacity-90">{getWeatherLabel(code)}</p>
                                            <p className="text-xs opacity-75 mt-1 flex items-center gap-1"><MapPin size={11} />{selectedLocation.name}</p>
                                        </div>

                                        <div className="sm:col-span-1 grid grid-cols-2 gap-2 sm:gap-3">
                                            <div className="bg-white rounded-xl p-2 sm:p-3 shadow-sm border border-sky-100 flex flex-col items-center justify-center text-center">
                                                <Droplets size={18} className="text-blue-400 mb-1" />
                                                <p className="text-lg sm:text-xl font-bold text-gray-800">{humidity}%</p>
                                                <p className="text-xs text-gray-500">Humidity</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-2 sm:p-3 shadow-sm border border-sky-100 flex flex-col items-center justify-center text-center">
                                                <Wind size={18} className="text-teal-400 mb-1" />
                                                <p className="text-lg sm:text-xl font-bold text-gray-800">{wind}</p>
                                                <p className="text-xs text-gray-500">Wind km/h</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-2 sm:p-3 shadow-sm border border-sky-100 flex flex-col items-center justify-center text-center">
                                                <CloudRain size={18} className="text-indigo-400 mb-1" />
                                                <p className="text-lg sm:text-xl font-bold text-gray-800">{precip} mm</p>
                                                <p className="text-xs text-gray-500">Precipitation</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-2 sm:p-3 shadow-sm border border-sky-100 flex flex-col items-center justify-center text-center">
                                                <Thermometer size={18} className="text-orange-400 mb-1" />
                                                <p className="text-lg sm:text-xl font-bold text-gray-800">{temp}°C</p>
                                                <p className="text-xs text-gray-500">Outdoor Temp</p>
                                            </div>
                                        </div>

                                        <div className="sm:col-span-1 bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-sky-100 flex flex-col justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                                                    <Lightbulb size={13} /> Drying Impact Assessment
                                                </p>
                                                <p className={`text-base font-bold ${impact.color}`}>{impact.label}</p>
                                                <p className="text-xs text-gray-600 mt-2 leading-relaxed">{impact.note}</p>
                                            </div>
                                            <div className="mt-3 pt-3 border-t border-gray-100">
                                                <p className="text-xs text-gray-400">
                                                    Threshold reference: &gt;65% RH = mold risk · &gt;40°C = fermentation risk
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* --- 7-DAY RAIN PREDICTION ROW --- */}
                                    {dailyForecast && (
                                        <div className="bg-white rounded-xl border border-sky-100 p-4 shadow-sm">
                                            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                                <CalendarDays size={16} className="text-sky-600" /> 7-Day Rain Forecast
                                            </h4>
                                            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                                {dailyForecast.time.map((day, i) => {
                                                    const precipProb = dailyForecast.precipitation_probability_max[i];
                                                    const rainSum = dailyForecast.precipitation_sum[i];
                                                    const date = new Date(day).toLocaleDateString("en-US", { weekday: 'short', day: 'numeric' });
                                                    const isRainy = rainSum > 1.0 || precipProb > 50;

                                                    return (
                                                        <div key={day} className={`min-w-[80px] p-2 rounded-lg text-center border text-xs flex flex-col items-center gap-1
                                                            ${isRainy ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-100"}`}>
                                                            <span className="font-semibold text-gray-600">{date}</span>
                                                            {isRainy ? <CloudRain size={18} className="text-blue-500" /> : <Sun size={18} className="text-orange-400" />}
                                                            <span className={`font-bold ${isRainy ? "text-blue-700" : "text-gray-500"}`}>
                                                                {rainSum.toFixed(1)}mm
                                                            </span>
                                                            <span className="text-[10px] text-gray-400">{precipProb}% Prob</span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {!weatherData && !weatherLoading && !weatherError && (
                            <div className="text-center py-6 text-gray-400 text-sm">
                                <Cloud size={36} className="mx-auto mb-2 opacity-30" />
                                Select a location above to load weather data.
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* STAGE SELECTION */}
            <div className="flex gap-2 sm:gap-4 mb-6 flex-wrap">
                <Button variant={stage === "Drying" ? "default" : "outline"} onClick={() => setStage("Drying")} className="flex-1 sm:flex-none">Drying Stage</Button>
                <Button variant={stage === "Roasting" ? "default" : "outline"} onClick={() => setStage("Roasting")} className="flex-1 sm:flex-none">Roasting Stage</Button>
            </div>

            {/* DRYING LAYOUT */}
            {stage === "Drying" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
                    <div className="space-y-4 sm:space-y-6">
                        <Card className="shadow-lg">
                            <CardHeader className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                                    <Thermometer size={20} />
                                    <span>Drying Environment (Left & Right)</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 sm:pt-6 space-y-4">
                                <div className="bg-blue-50 p-3 sm:p-4 rounded-lg border border-blue-200">
                                    <h3 className="font-semibold text-sm sm:text-base text-blue-900 mb-2">Sensor 1 (Left Side)</h3>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm sm:text-base">
                                        <div className="flex items-center gap-2"><Thermometer size={16} className="text-red-500" /> {liveData.sensorLeft.temp.toFixed(1)}°C</div>
                                        <div className="flex items-center gap-2"><Droplets size={16} className="text-blue-500" /> {liveData.sensorLeft.humi.toFixed(1)}%</div>
                                    </div>
                                </div>
                                <div className="bg-green-50 p-3 sm:p-4 rounded-lg border border-green-200">
                                    <h3 className="font-semibold text-sm sm:text-base text-green-900 mb-2">Sensor 2 (Right Side)</h3>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm sm:text-base">
                                        <div className="flex items-center gap-2"><Thermometer size={16} className="text-red-500" /> {liveData.sensorRight.temp.toFixed(1)}°C</div>
                                        <div className="flex items-center gap-2"><Droplets size={16} className="text-blue-500" /> {liveData.sensorRight.humi.toFixed(1)}%</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="shadow-lg">
                            <CardHeader className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
                                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                                    <Scale size={20} /> Real-Time Weight & Moisture
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 sm:pt-6">
                                <div className="flex flex-col items-center justify-center mb-6">
                                    <p className="text-xs sm:text-sm text-gray-600 mb-2">Current Mass (Water Loss Tracker)</p>
                                    <div className="text-4xl sm:text-6xl font-bold text-orange-600">
                                        {formatWeight(liveData.drying.weight)}
                                    </div>
                                    <p className="text-sm font-semibold text-gray-600 mt-2">
                                        Calculated Moisture: <span className="text-orange-600">{liveData.drying.moisture.toFixed(1)}%</span>
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">Target: {thresholds.dry_target_weight}%</p>
                                </div>

                                {/* ADDED: ESTIMATED COMPLETION PREDICTION */}
                                <div className="bg-orange-50 rounded-lg p-3 border border-orange-100 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-orange-800 font-medium text-sm">
                                        <Clock size={16} /> Estimated Time to Finish
                                    </div>
                                    <div className="font-bold text-orange-900 text-sm">
                                        {dryingEstimation || "Calculating..."}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="shadow-lg">
                        <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-500 text-white"><CardTitle>Drying Trend</CardTitle></CardHeader>
                        <CardContent className="pt-4 sm:pt-6">
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={dryingGraphData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="timestamp" tickFormatter={formatTimeLabel} tick={{ fontSize: 12 }} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                                    <Tooltip labelFormatter={formatTimeLabel} />
                                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                                    <Line yAxisId="left" type="monotone" dataKey="weight" stroke="#8b5cf6" name="Weight (kg)" dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="humidity" stroke="#ec4899" name="Humidity (%)" dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="temperature" stroke="#f59e0b" name="Temp (°C)" strokeDasharray="5 5" dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* ROASTING LAYOUT */}
            {stage === "Roasting" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
                    <Card className="shadow-lg">
                        <CardHeader className="bg-gradient-to-r from-red-600 to-orange-600 text-white">
                            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl"><Flame size={20} /> Roasting Data</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 sm:pt-6 flex flex-col items-center justify-center min-h-[300px]">
                            <p className="text-xs sm:text-sm text-gray-600 mb-2">Current Temperature</p>
                            <div className="text-4xl sm:text-6xl font-bold text-red-600">{liveData.roaster.temp}°C</div>
                            <p className="text-xs sm:text-sm text-gray-500 mt-4 text-center">*Optimal: {thresholds.roast_min_temp}°C (First Crack) – {thresholds.roast_max_temp}°C (Medium-Dark)</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-lg">
                        <CardHeader className="bg-gradient-to-r from-red-500 to-pink-500 text-white"><CardTitle>Roasting Curve</CardTitle></CardHeader>
                        <CardContent className="pt-4 sm:pt-6">
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={roastingGraphData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="timestamp" tickFormatter={formatTimeLabel} tick={{ fontSize: 12 }} />
                                    <YAxis tick={{ fontSize: 12 }} />
                                    <Tooltip labelFormatter={formatTimeLabel} />
                                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                                    <Line type="monotone" dataKey="temperature" stroke="#dc2626" name="Temp (°C)" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* AI ANALYSIS CARD */}
            <Card className="shadow-lg mt-6 bg-white">
                <CardHeader className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                    <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                        <Info size={20} />
                        <span>Real-Time Analysis & Recommendations</span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <SensorStatusAlert
                        s1Data={liveData.sensorLeft}
                        s2Data={liveData.sensorRight}
                        roastData={liveData.roaster}
                        weightValue={liveData.drying.weight}
                        moistureValue={liveData.drying.moisture}
                        currentStage={stage}
                        currentThresholds={thresholds}
                        outdoorWeather={weatherData}
                    />
                </CardContent>
            </Card>
        </div>
    );
}