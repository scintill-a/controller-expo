#include <WString.h>
#include <HardwareSerial.h>
#include <Arduino.h>

String G_Bluetooth_value;
volatile int BLE_Change_SPEED;

String lastMovementCommand = "S"; // Change to String for multi-char commands

float mapfloat(float x, float in_min, float in_max, float out_min, float out_max)
{
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

void executeMovement(String command, float value) {
  if (command == "F") {
    digitalWrite(2, HIGH);
    analogWrite(5, (BLE_Change_SPEED / 10) * 22.5);
    digitalWrite(4, LOW);
    analogWrite(6, (BLE_Change_SPEED / 10) * 22.5);
  } else if (command == "B") {
    digitalWrite(2, LOW);
    analogWrite(5, (BLE_Change_SPEED / 10) * 22.5);
    digitalWrite(4, HIGH);
    analogWrite(6, (BLE_Change_SPEED / 10) * 22.5);
  } else if (command == "L") {
    digitalWrite(2, LOW);
    analogWrite(5, (BLE_Change_SPEED / 10) * 11.25);
    digitalWrite(4, LOW);
    analogWrite(6, (BLE_Change_SPEED / 10) * 11.25);
  } else if (command == "R") {
    digitalWrite(2, HIGH);
    analogWrite(5, (BLE_Change_SPEED / 10) * 11.25);
    digitalWrite(4, HIGH);
    analogWrite(6, (BLE_Change_SPEED / 10) * 11.25);
  } else if (command == "S") {
    digitalWrite(2, LOW);
    analogWrite(5, 0);
    digitalWrite(4, LOW);
    analogWrite(6, 0);
  } else if (command == "FR") {
    digitalWrite(2, HIGH);  // Left motor forward
    analogWrite(5, (BLE_Change_SPEED / 10) * 22.5); // Full speed left
    digitalWrite(4, LOW);   // Right motor forward
    analogWrite(6, (BLE_Change_SPEED / 10) * 11.25); // Half speed right
  } else if (command == "FL") {
    digitalWrite(2, HIGH);  // Left motor forward
    analogWrite(5, (BLE_Change_SPEED / 10) * 11.25); // Half speed left
    digitalWrite(4, LOW);   // Right motor forward
    analogWrite(6, (BLE_Change_SPEED / 10) * 22.5); // Full speed right
  } else if (command == "BR") {
    digitalWrite(2, LOW);   // Left motor backward
    analogWrite(5, (BLE_Change_SPEED / 10) * 22.5); // Full speed left
    digitalWrite(4, HIGH);  // Right motor backward
    analogWrite(6, (BLE_Change_SPEED / 10) * 11.25); // Half speed right
  } else if (command == "BL") {
    digitalWrite(2, LOW);   // Left motor backward
    analogWrite(5, (BLE_Change_SPEED / 10) * 11.25); // Half speed left
    digitalWrite(4, HIGH);  // Right motor backward
    analogWrite(6, (BLE_Change_SPEED / 10) * 22.5); // Full speed right
  }
}

void setup(){
  Serial.begin(9600);
  G_Bluetooth_value = "";
  BLE_Change_SPEED = 50;
  pinMode(2, OUTPUT);
  pinMode(5, OUTPUT);
  pinMode(4, OUTPUT);
  pinMode(6, OUTPUT);
}

void loop(){
  while (Serial.available() > 0) {
    G_Bluetooth_value = G_Bluetooth_value + ((char)(Serial.read()));
    delay(2);
  }
  if (G_Bluetooth_value.length() > 0) {
    String cmd = G_Bluetooth_value;
    float value = (BLE_Change_SPEED / 10) * 15;

    // Handle two-character commands for diagonal movement
    if (cmd.startsWith("FR")) {
      lastMovementCommand = "FR";
      executeMovement("FR", value);
      Serial.println("FR");
      G_Bluetooth_value = "";
      return;
    } else if (cmd.startsWith("FL")) {
      lastMovementCommand = "FL";
      executeMovement("FL", value);
      Serial.println("FL");
      G_Bluetooth_value = "";
      return;
    } else if (cmd.startsWith("BR")) {
      lastMovementCommand = "BR";
      executeMovement("BR", value);
      Serial.println("BR");
      G_Bluetooth_value = "";
      return;
    } else if (cmd.startsWith("BL")) {
      lastMovementCommand = "BL";
      executeMovement("BL", value);
      Serial.println("BL");
      G_Bluetooth_value = "";
      return;
    }

    char command = cmd.charAt(0);
    Serial.println(G_Bluetooth_value);

    switch (command) {
      case 'F':
      case 'B':
      case 'L':
      case 'R':
        lastMovementCommand = String(command);
        executeMovement(String(command), value);
        break;

      case 'S':
        lastMovementCommand = "S";
        executeMovement("S", value);
        break;

      case '+': // Increase speed
        BLE_Change_SPEED += 10;
        if (BLE_Change_SPEED > 100) BLE_Change_SPEED = 100;
        Serial.println(BLE_Change_SPEED);
        executeMovement(lastMovementCommand, (BLE_Change_SPEED / 10) * 15);
        break;

      case '-': // Decrease speed
        BLE_Change_SPEED -= 10;
        if (BLE_Change_SPEED < 0) BLE_Change_SPEED = 0;
        Serial.println(BLE_Change_SPEED);
        executeMovement(lastMovementCommand, (BLE_Change_SPEED / 10) * 15);
        break;

      case '/': // Set speed to 50
        BLE_Change_SPEED = 50;
        Serial.println(BLE_Change_SPEED);
        executeMovement(lastMovementCommand, (BLE_Change_SPEED / 10) * 15);
        break;

      default: // Invalid command
        Serial.println("Invalid Command");
        break;
    }

    G_Bluetooth_value = "";
  }
}