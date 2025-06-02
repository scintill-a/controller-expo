import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { BleManager, State as BleState, Device } from "react-native-ble-plx";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { btoa } from "react-native-quick-base64";
import styles from "./styles";

const manager = new BleManager();
const SCAN_DURATION_MS = 10000;

const DEFAULT_COMMANDS = {
  F: "F", // Forward
  B: "B", // Backward
  L: "L", // Left
  R: "R", // Right
  S: "S", // Stop
  "+": "+", // Speed up
  "-": "-", // Speed down
};

export default function App() {
  const [device, setDevice] = useState<Device | null>(null);
  const [devicesMap, setDevicesMap] = useState<Map<string, Device>>(new Map());
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(50); // 0-100, step 10
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(
    null
  );
  const [showDeviceModal, setShowDeviceModal] = useState<boolean>(false);

  const [serviceUUID, setServiceUUID] = useState<string | null>(null);
  const [characteristicUUID, setCharacteristicUUID] = useState<string | null>(
    null
  );

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"about" | "help" | "advanced">(
    "about"
  );
  const [commandMap, setCommandMap] = useState({ ...DEFAULT_COMMANDS });
  const [editMap, setEditMap] = useState({ ...DEFAULT_COMMANDS });

  const scanTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Send '/' automatically when connected to BLE
  useEffect(() => {
    if (device && serviceUUID && characteristicUUID) {
      sendCommand("/");
      setSpeed(50);
    }
  }, [device, serviceUUID, characteristicUUID]);

  useEffect(() => {
    // Allow both orientations
    ScreenOrientation.unlockAsync();
    Alert.alert(
      "Enable Bluetooth & Location",
      "Please make sure your Bluetooth and Location are turned on for BLE scanning."
    );
    // Set speed to 50 and send immediately on mount
    setSpeed(50);
    return () => {
      manager.stopDeviceScan();
      manager.destroy();
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
    };
  }, []);

  const requestAndroidPermissions = async () => {
    if (Platform.OS !== "android") return true;
    try {
      const apiLevel = Platform.Version as number;
      if (apiLevel >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return status === "granted";
      }
    } catch (e) {
      Alert.alert("Permission error", e?.toString());
      return false;
    }
  };

  const scanForDevices = async () => {
    const bleState = await manager.state();
    let locationStatus = "granted";
    let locationEnabled = true;
    if (Platform.OS === "android") {
      const statusObj = await Location.getForegroundPermissionsAsync();
      locationStatus = statusObj.status;
      locationEnabled = await Location.hasServicesEnabledAsync();
    }

    const bluetoothOff = bleState !== BleState.PoweredOn;
    const locationOff =
      Platform.OS === "android" &&
      (locationStatus !== "granted" || !locationEnabled);

    if (bluetoothOff && locationOff) {
      Alert.alert(
        "Bluetooth and Location are Off",
        "Please turn on both Bluetooth and Location services (and grant permission) to scan for devices."
      );
      return;
    } else if (bluetoothOff) {
      Alert.alert(
        "Bluetooth is Off",
        "Please turn on Bluetooth to scan for devices."
      );
      return;
    } else if (locationOff) {
      Alert.alert(
        !locationEnabled
          ? "Location is Off"
          : "Location Permission Not Granted",
        !locationEnabled
          ? "Please turn on Location services to scan for devices."
          : "Please grant Location permission to scan for devices."
      );
      return;
    }

    manager.stopDeviceScan();
    if (scanTimeout.current) clearTimeout(scanTimeout.current);
    setDevicesMap(new Map());
    setIsScanning(true);
    setShowDeviceModal(true);

    let permissionGranted = true;
    if (Platform.OS === "android") {
      permissionGranted = await requestAndroidPermissions();
      if (!permissionGranted) {
        Alert.alert("Permission not granted to access Bluetooth/Location");
        setIsScanning(false);
        setShowDeviceModal(false);
        return;
      }
    }

    try {
      manager.startDeviceScan(null, null, (error, scannedDevice) => {
        if (error) {
          console.error(error);
          setIsScanning(false);
          setShowDeviceModal(false);
          if (scanTimeout.current) clearTimeout(scanTimeout.current);
          return;
        }
        if (scannedDevice && (scannedDevice.name || scannedDevice.localName)) {
          setDevicesMap((prev) => {
            if (!prev.has(scannedDevice.id)) {
              const newMap = new Map(prev);
              newMap.set(scannedDevice.id, scannedDevice);
              return newMap;
            }
            return prev;
          });
        }
      });
      scanTimeout.current = setTimeout(() => {
        manager.stopDeviceScan();
        setIsScanning(false);
      }, SCAN_DURATION_MS);
    } catch (e) {
      setIsScanning(false);
      setShowDeviceModal(false);
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      Alert.alert("Scan error", e?.toString());
    }
  };

  const connectToDevice = async (d: Device) => {
    manager.stopDeviceScan();
    if (scanTimeout.current) clearTimeout(scanTimeout.current);
    setIsScanning(false);
    try {
      const connected = await d.connect();
      const discovered =
        await connected.discoverAllServicesAndCharacteristics();
      setDevice(discovered);
      setConnectedDeviceId(discovered.id);

      let foundService: string | null = null;
      let foundChar: string | null = null;
      try {
        const services = await discovered.services();
        for (const service of services) {
          const characteristics = await service.characteristics();
          for (const char of characteristics) {
            if (char.isWritableWithResponse || char.isWritableWithoutResponse) {
              foundService = service.uuid;
              foundChar = char.uuid;
              break;
            }
          }
          if (foundService && foundChar) break;
        }
      } catch (e) {}
      setServiceUUID(foundService);
      setCharacteristicUUID(foundChar);

      setShowDeviceModal(false);
      if (foundService && foundChar) {
        Alert.alert(
          "Connected to " + (discovered.name || discovered.localName),
          `Service UUID: ${foundService}\nCharacteristic UUID: ${foundChar}`
        );
      } else {
        Alert.alert(
          "Connected, but no writable characteristic found.",
          "You may not be able to send commands to this device."
        );
      }
    } catch (err) {
      setIsScanning(false);
      setShowDeviceModal(false);
      Alert.alert("Connection error", err?.toString());
    }
  };

  const disconnectDevice = async () => {
    if (device) {
      try {
        await device.cancelConnection();
      } catch (err) {}
      setDevice(null);
      setConnectedDeviceId(null);
      setServiceUUID(null);
      setCharacteristicUUID(null);
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      Alert.alert("Disconnected", "Device has been disconnected.");
    }
  };

  const sendCommand = async (command: string) => {
    if (!device || !serviceUUID || !characteristicUUID) {
      Alert.alert(
        "Not connected to any BLE device or writable characteristic."
      );
      return;
    }
    try {
      await device.writeCharacteristicWithResponseForService(
        serviceUUID,
        characteristicUUID,
        btoa(command)
      );
      console.log(`Sent: ${command}`);
    } catch (err) {
      console.error("Send error", err);
    }
  };

  const handleSpeedChange = (delta: number) => {
    setSpeed((prev) => {
      let next = prev + delta;
      if (next > 100) next = 100;
      if (next < 0) next = 0;
      const steps = Math.abs(next - prev) / 10;
      const cmd = delta > 0 ? commandMap["+"] : commandMap["-"];
      for (let i = 0; i < steps; i++) {
        sendCommand(cmd);
      }
      return next;
    });
  };

  // Replace handleDirection with a function that takes key and returns handlers
  const getDirectionHandlers = (key: keyof typeof DEFAULT_COMMANDS) => ({
    onPressIn: () => sendCommand(commandMap[key]),
    onPressOut: () => sendCommand(commandMap["S"]),
  });

  const openSettings = () => {
    setEditMap({ ...commandMap });
    setShowSettings(true);
    setSettingsTab("about");
  };
  const saveAdvancedSettings = () => {
    setCommandMap({ ...editMap });
    setShowSettings(false);
  };

  // Gesture objects for D-pad
  const getDirectionGesture = (key: keyof typeof DEFAULT_COMMANDS) =>
    Gesture.LongPress()
      .minDuration(50)
      .onStart(() => sendCommand(commandMap[key]))
      .onEnd(() => sendCommand(commandMap["S"]))
      .runOnJS(true);

  // Gesture objects for speed buttons
  const getSpeedGesture = (delta: number) =>
    Gesture.LongPress()
      .minDuration(50)
      .onStart(() => handleSpeedChange(delta))
      .runOnJS(true);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f5f5f5" }}>
        {/* Top bar */}
        <View
          style={[
            styles.topBar,
            isLandscape && {
              flexDirection: "row",
              alignItems: "flex-start",
              paddingTop: 18,
            },
            !isLandscape && { marginTop: 18 },
          ]}
        >
          {isLandscape ? (
            <>
              {/* Settings on the left */}
              <TouchableOpacity
                style={[
                  styles.settingsButton,
                  { alignSelf: "flex-start", marginTop: 8 },
                ]}
                onPress={openSettings}
              >
                <Ionicons name="settings-outline" size={28} color="#333" />
              </TouchableOpacity>
              {/* Title block in the center */}
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "flex-start",
                }}
              >
                <Text style={styles.labTitle}>
                  Sorsogon Community Innovation Labs
                </Text>
                <Text
                  style={[
                    styles.title,
                    { marginTop: 2, marginBottom: 0, textAlign: "center" },
                  ]}
                >
                  BLE Car Controller
                </Text>
              </View>
              {/* Spacer for symmetry */}
              <View style={{ width: 40 }} />
            </>
          ) : (
            <>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={openSettings}
              >
                <Ionicons name="settings-outline" size={28} color="#333" />
              </TouchableOpacity>
            </>
          )}
        </View>
        {/* Title below top bar, always centered and spaced down (portrait only) */}
        {!isLandscape && (
          <View style={styles.titleContainer}>
            <Text style={styles.labTitle}>
              Sorsogon Community Innovation Labs
            </Text>
            <Text style={styles.title}>BLE Car Controller</Text>
          </View>
        )}
        {/* Connection bar */}
        <View
          style={[
            styles.connBar,
            isLandscape
              ? {
                  marginTop: 0,
                  marginBottom: 0,
                  alignItems: "center",
                  justifyContent: "center",
                }
              : { marginTop: 0, marginBottom: 0 },
          ]}
        >
          <View
            style={
              isLandscape
                ? {
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                  }
                : undefined
            }
          >
            {device ? (
              <View
                style={{
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0,
                  justifyContent: isLandscape ? "center" : undefined,
                }}
              >
                <Text style={styles.connectedInfoText}>
                  Connected: {device.name || device.localName || "Unnamed"}
                </Text>
                <Text>({device.id})</Text>
                <TouchableOpacity
                  style={styles.disconnectButton}
                  onPress={disconnectDevice}
                >
                  <Text style={styles.disconnectButtonText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.connectButton}
                onPress={scanForDevices}
                disabled={isScanning}
              >
                <Ionicons name="bluetooth" size={20} color="#fff" />
                <Text style={styles.connectButtonText}>
                  {isScanning ? "Scanning..." : "Connect"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {/* Main controls */}
        <View
          style={
            isLandscape
              ? [styles.landscapeContainer, { marginTop: 10 }]
              : styles.portraitContainer
          }
        >
          <View
            style={
              isLandscape
                ? [
                    styles.leftPanel,
                    {
                      justifyContent: "center",
                      marginTop: 0,
                      marginBottom: 0,
                    },
                  ]
                : [
                    styles.portraitPanel,
                    { alignItems: "center", marginTop: 60, marginBottom: 0 },
                  ]
            }
          >
            <View style={styles.controllerContainer}>
              <View style={styles.dpadRow}>
                <GestureDetector gesture={getDirectionGesture("F")}>
                  <View
                    style={styles.dpadButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.dpadText}>▲</Text>
                  </View>
                </GestureDetector>
              </View>
              <View style={styles.dpadRow}>
                <GestureDetector gesture={getDirectionGesture("L")}>
                  <View
                    style={styles.dpadButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.dpadText}>◀</Text>
                  </View>
                </GestureDetector>
                <GestureDetector gesture={getDirectionGesture("S")}>
                  <View
                    style={styles.dpadButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.dpadText}>■</Text>
                  </View>
                </GestureDetector>
                <GestureDetector gesture={getDirectionGesture("R")}>
                  <View
                    style={styles.dpadButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.dpadText}>▶</Text>
                  </View>
                </GestureDetector>
              </View>
              <View style={styles.dpadRow}>
                <GestureDetector gesture={getDirectionGesture("B")}>
                  <View
                    style={styles.dpadButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.dpadText}>▼</Text>
                  </View>
                </GestureDetector>
              </View>
            </View>
            {/* Portrait: Speed controls just below D-pad */}
            {!isLandscape && (
              <View style={[styles.speedPortraitWrapper, { marginTop: 40 }]}>
                <View style={styles.speedRow}>
                  <GestureDetector gesture={getSpeedGesture(-10)}>
                    <View
                      style={styles.speedButton}
                      pointerEvents={device ? "auto" : "none"}
                    >
                      <Text style={styles.speedText}>-</Text>
                    </View>
                  </GestureDetector>
                  <Text style={styles.speedValue}>{speed}</Text>
                  <GestureDetector gesture={getSpeedGesture(10)}>
                    <View
                      style={styles.speedButton}
                      pointerEvents={device ? "auto" : "none"}
                    >
                      <Text style={styles.speedText}>+</Text>
                    </View>
                  </GestureDetector>
                </View>
                <Text style={styles.speedLabel}>Speed (0-100)</Text>
              </View>
            )}
          </View>
          {/* Landscape: Speed controls on right */}
          {isLandscape && (
            <View style={styles.rightPanel}>
              <View style={styles.speedRow}>
                <GestureDetector gesture={getSpeedGesture(-10)}>
                  <View
                    style={styles.speedButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.speedText}>-</Text>
                  </View>
                </GestureDetector>
                <Text style={styles.speedValue}>{speed}</Text>
                <GestureDetector gesture={getSpeedGesture(10)}>
                  <View
                    style={styles.speedButton}
                    pointerEvents={device ? "auto" : "none"}
                  >
                    <Text style={styles.speedText}>+</Text>
                  </View>
                </GestureDetector>
              </View>
              <Text style={styles.speedLabel}>Speed (0-100)</Text>
            </View>
          )}
        </View>
        <Modal
          visible={showDeviceModal}
          transparent
          animationType="slide"
          onRequestClose={() => {
            setShowDeviceModal(false);
            setIsScanning(false);
            manager.stopDeviceScan();
            if (scanTimeout.current) clearTimeout(scanTimeout.current);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Nearby Devices</Text>
              {isScanning && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <ActivityIndicator />
                  <Text style={{ marginLeft: 10 }}>Scanning...</Text>
                </View>
              )}
              <FlatList
                data={Array.from(devicesMap.values())}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 300, width: "100%" }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.deviceItem,
                      item.id === connectedDeviceId && styles.connectedDevice,
                    ]}
                    onPress={() => connectToDevice(item)}
                    disabled={item.id === connectedDeviceId}
                  >
                    <Text>
                      {item.name || item.localName || "Unnamed"} ({item.id})
                    </Text>
                    {item.id === connectedDeviceId && (
                      <Text style={{ color: "green" }}>Connected</Text>
                    )}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  !isScanning ? (
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ textAlign: "center", color: "#888" }}>
                        No devices found.
                      </Text>
                    </View>
                  ) : null
                }
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  width: "100%",
                  marginTop: 15,
                }}
              >
                <TouchableOpacity
                  style={styles.rescanButton}
                  onPress={() => {
                    manager.stopDeviceScan();
                    if (scanTimeout.current) clearTimeout(scanTimeout.current);
                    scanForDevices();
                  }}
                  disabled={isScanning}
                >
                  <Text style={styles.rescanButtonText}>Refresh</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => {
                    setShowDeviceModal(false);
                    setIsScanning(false);
                    manager.stopDeviceScan();
                    if (scanTimeout.current) clearTimeout(scanTimeout.current);
                  }}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          visible={showSettings}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSettings(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                // About/Help: small, Advanced: big
                settingsTab === "advanced"
                  ? {
                      maxWidth: isLandscape ? 520 : 420,
                      width: isLandscape ? "98%" : "92%",
                      maxHeight: isLandscape ? "90%" : undefined,
                    }
                  : {
                      maxWidth: 420,
                      width: "92%",
                      maxHeight: 420,
                    },
              ]}
            >
              <View style={{ flexDirection: "row", marginBottom: 10 }}>
                <TouchableOpacity
                  style={[
                    styles.settingsTab,
                    settingsTab === "about" && styles.settingsTabActive,
                  ]}
                  onPress={() => setSettingsTab("about")}
                >
                  <Text style={styles.settingsTabText}>About</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.settingsTab,
                    settingsTab === "help" && styles.settingsTabActive,
                  ]}
                  onPress={() => setSettingsTab("help")}
                >
                  <Text style={styles.settingsTabText}>Help</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.settingsTab,
                    settingsTab === "advanced" && styles.settingsTabActive,
                  ]}
                  onPress={() => setSettingsTab("advanced")}
                >
                  <Text style={styles.settingsTabText}>Advanced</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={{ width: "100%" }}
                contentContainerStyle={
                  settingsTab === "advanced"
                    ? isLandscape
                      ? { paddingBottom: 24, minHeight: 320 }
                      : { paddingBottom: 12 }
                    : { paddingBottom: 12 }
                }
                horizontal={false}
                alwaysBounceVertical={true}
              >
                {settingsTab === "about" && (
                  <View>
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: 15,
                        color: "#023c69",
                        textAlign: "center",
                        marginBottom: 0,
                        letterSpacing: 0.2,
                      }}
                    >
                      Sorsogon Community Innovation Labs
                    </Text>
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: 18,
                        marginBottom: 8,
                        color: "#023c69",
                        textAlign: "center",
                      }}
                    >
                      BLE Car Controller
                    </Text>
                    <Text>
                      Version 1.0.0{"\n"}
                      Developed for controlling BLE-enabled cars via Bluetooth
                      Low Energy.
                    </Text>
                    <Text style={{ marginTop: 10, fontWeight: "bold" }}>
                      Facebook:
                    </Text>
                    <Text
                      style={{
                        marginLeft: 10,
                        color: "#1976d2",
                      }}
                      onPress={() =>
                        Linking.openURL(
                          "https://www.facebook.com/share/g/18r6AjqyBG/"
                        )
                      }
                    >
                      Sorsogon Community Innovation Labs
                    </Text>
                    <Text
                      style={{
                        marginLeft: 10,
                        color: "#1976d2",
                      }}
                      onPress={() =>
                        Linking.openURL(
                          "https://www.facebook.com/profile.php?id=61571653147947"
                        )
                      }
                    >
                      The Workshop
                    </Text>
                    <Text style={{ marginTop: 10, fontWeight: "bold" }}>
                      Website:
                    </Text>
                    <Text
                      style={{
                        marginLeft: 10,
                        color: "#1976d2",
                      }}
                      onPress={() =>
                        Linking.openURL("http://innovationlabs.ph/")
                      }
                    >
                      Innovation Labs
                    </Text>
                  </View>
                )}
                {settingsTab === "help" && (
                  <View>
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: 16,
                        marginBottom: 8,
                      }}
                    >
                      Help
                    </Text>
                    <Text>
                      - Use the D-pad to control the car&apos;s direction.{"\n"}
                      - Use the + and - buttons to adjust speed.{"\n"}- Tap the
                      Bluetooth icon to connect/disconnect.{"\n"}- In Advanced,
                      you can remap controller commands.{"\n"}
                    </Text>
                  </View>
                )}
                {settingsTab === "advanced" && (
                  <View>
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: 16,
                        marginBottom: 8,
                      }}
                    >
                      Advanced: Command Mapping
                    </Text>
                    <Text style={{ marginBottom: 8 }}>
                      You can change the BLE command sent for each control.
                      {"\n"}
                    </Text>
                    <View
                      style={{
                        flexDirection: "column",
                        flexWrap: "nowrap",
                        gap: 12,
                        justifyContent: "flex-start",
                      }}
                    >
                      {Object.entries(DEFAULT_COMMANDS).map(([key, defVal]) => (
                        <View
                          key={key}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 6,
                          }}
                        >
                          <Text style={{ width: 90 }}>
                            {key === "F" && "Forward"}
                            {key === "B" && "Backward"}
                            {key === "L" && "Left"}
                            {key === "R" && "Right"}
                            {key === "S" && "Stop"}
                            {key === "+" && "Speed Up"}
                            {key === "-" && "Speed Down"}
                          </Text>
                          <TextInput
                            style={styles.commandInput}
                            value={
                              editMap[key as keyof typeof DEFAULT_COMMANDS]
                            }
                            onChangeText={(v) =>
                              setEditMap((prev) => ({
                                ...prev,
                                [key]: v,
                              }))
                            }
                            autoCapitalize="characters"
                            maxLength={12}
                          />
                          <Text style={{ color: "#888", marginLeft: 6 }}>
                            (Default: {defVal})
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Text style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
                      Note: If you change the command (e.g., from &quot;F&quot;
                      to &quot;UP&quot;), make sure your Arduino code or device
                      firmware is updated to recognize and respond to the new
                      command.
                    </Text>
                  </View>
                )}
              </ScrollView>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  marginTop: 12,
                  gap: 10,
                }}
              >
                {settingsTab === "advanced" && (
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={saveAdvancedSettings}
                  >
                    <Text style={styles.saveButtonText}>Save</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setShowSettings(false)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
